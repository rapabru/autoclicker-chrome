// AutoClicker Pro - Content Script
// Diseñado para hacer clics automáticos sin bloquear el ratón del sistema ni interferir con otras pestañas o ventanas.
// Incluye blindaje para ejecución ininterrumpida en segundo plano (Web Audio Keep-Alive + Anti-Pause + RAF shim).

(() => {
  if (window.__AUTOCLICKER_PRO_INITIALIZED__) {
    if (window.__AUTOCLICKER_PRO_TOGGLE__) {
      window.__AUTOCLICKER_PRO_TOGGLE__();
    }
    return;
  }
  window.__AUTOCLICKER_PRO_INITIALIZED__ = true;

  const state = {
    running: false,
    targetMode: 'element',
    targetElement: null,
    targetSelector: '',
    targetCoords: { x: 0, y: 0 },
    cachedCoordsElement: null,
    clickType: 'left',
    intervalMs: 100,
    randomJitter: false,
    isInfinite: true,
    totalClicksGoal: 100,
    clicksCount: 0,
    startTime: null,
    pickingElement: false,
    minimized: false,
    visible: true,
    keepAliveBackground: true
  };

  // Rastreo de visibilidad real de la pestaña
  let realTabIsHidden = document.hidden;
  document.addEventListener('visibilitychange', () => {
    realTabIsHidden = document.visibilityState === 'hidden';
  }, true);
  window.addEventListener('blur', () => {
    realTabIsHidden = true;
  }, true);
  window.addEventListener('focus', () => {
    realTabIsHidden = false;
  }, true);

  // ============================================================================
  // 1. SISTEMA WEB AUDIO KEEP-ALIVE
  // En Chromium, cualquier pestaña con AudioContext activo se declara "reproduciendo audio".
  // Esto EXIME a la pestaña del throttling agresivo de Chrome y previene su congelación/suspensión.
  // ============================================================================
  let audioContext = null;
  let audioOscillator = null;

  function startBackgroundAudioKeepAlive() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      if (!audioContext) {
        audioContext = new AudioCtx();
      }
      if (audioContext.state === 'suspended') {
        audioContext.resume();
      }
      if (!audioOscillator) {
        const osc = audioContext.createOscillator();
        const gain = audioContext.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1, audioContext.currentTime); // 1 Hz (inaudible)
        gain.gain.setValueAtTime(0.00001, audioContext.currentTime); // Volumen prácticamente nulo
        osc.connect(gain);
        gain.connect(audioContext.destination);
        osc.start();
        audioOscillator = osc;
      }
    } catch (err) {
      console.warn('[AutoClicker Pro] Audio keep-alive error:', err);
    }
  }

  function stopBackgroundAudioKeepAlive() {
    try {
      if (audioOscillator) {
        audioOscillator.stop();
        audioOscillator.disconnect();
        audioOscillator = null;
      }
    } catch (err) {}
  }

  // ============================================================================
  // 2. SISTEMA ANTI-PAUSA (Evita que juegos o páginas web se pausen al salir)
  // Muchas webs pausan la lógica cuando detectan document.hidden o window.onblur.
  // Engañamos a la página para que crea que sigue 100% visible y enfocada.
  // ============================================================================
  let originalHiddenDesc = null;
  let originalVisibilityDesc = null;
  let originalHasFocus = null;
  let antiPauseInstalled = false;

  function installAntiPauseHooks() {
    if (antiPauseInstalled) return;
    antiPauseInstalled = true;

    try {
      originalHiddenDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden') ||
                           Object.getOwnPropertyDescriptor(document, 'hidden');
      originalVisibilityDesc = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState') ||
                               Object.getOwnPropertyDescriptor(document, 'visibilityState');
      originalHasFocus = document.hasFocus ? document.hasFocus.bind(document) : null;
    } catch (e) {}

    // Interceptar eventos blur y visibilitychange para que los scripts de la página no se enteren de que saliste
    const blockEvent = (e) => {
      if (state.running && state.keepAliveBackground) {
        e.stopImmediatePropagation();
      }
    };

    window.addEventListener('blur', blockEvent, true);
    window.addEventListener('focusout', blockEvent, true);
    document.addEventListener('visibilitychange', blockEvent, true);
    window.addEventListener('visibilitychange', blockEvent, true);
  }

  function enableAntiPause() {
    installAntiPauseHooks();
    try {
      Object.defineProperty(document, 'hidden', {
        get: () => false,
        configurable: true
      });
      Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible',
        configurable: true
      });
      Object.defineProperty(document, 'webkitVisibilityState', {
        get: () => 'visible',
        configurable: true
      });
      document.hasFocus = () => true;
    } catch (e) {}
  }

  function disableAntiPause() {
    try {
      if (originalHiddenDesc) {
        Object.defineProperty(document, 'hidden', originalHiddenDesc);
      }
      if (originalVisibilityDesc) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityDesc);
      }
      if (originalHasFocus) {
        document.hasFocus = originalHasFocus;
      }
    } catch (e) {}
  }

  // ============================================================================
  // 3. SHIM DE requestAnimationFrame PARA SEGUNDO PLANO
  // Chrome detiene los callbacks de requestAnimationFrame cuando la pestaña está oculta.
  // Si una web o juego actualiza su estado vía RAF, se congela. Esto lo mantiene corriendo.
  // ============================================================================
  try {
    const nativeRAF = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = function(callback) {
      if (state.running && state.keepAliveBackground && realTabIsHidden) {
        return setTimeout(() => {
          callback(performance.now());
        }, 16);
      }
      return nativeRAF(callback);
    };
  } catch (e) {}

  // ============================================================================
  // 4. CONTADOR EN EL TÍTULO DE LA PESTAÑA (Visualización directa desde otras pestañas)
  // ============================================================================
  let originalDocumentTitle = '';
  function updateTabTitle(count) {
    if (!originalDocumentTitle) {
      originalDocumentTitle = document.title || 'Página';
    }
    const cleanTitle = originalDocumentTitle.replace(/^\(\d+.*?\)\s*⚡\s*/, '');
    document.title = `(${count.toLocaleString()}) ⚡ ${cleanTitle}`;
  }

  function restoreTabTitle() {
    if (originalDocumentTitle) {
      document.title = originalDocumentTitle;
      originalDocumentTitle = '';
    }
  }

  // ============================================================================
  // 5. MOTOR TEMPORIZADOR RESILIENTE (Web Worker con respaldo de setInterval)
  // ============================================================================
  let tickerWorker = null;
  let fallbackTimerId = null;

  function getTickerWorker() {
    if (!tickerWorker) {
      try {
        const workerCode = `
          let timerId = null;
          self.onmessage = function(e) {
            if (e.data.cmd === 'start') {
              clearInterval(timerId);
              const interval = Math.max(5, e.data.interval || 100);
              timerId = setInterval(() => {
                self.postMessage({ type: 'tick' });
              }, interval);
            } else if (e.data.cmd === 'stop') {
              clearInterval(timerId);
              timerId = null;
            }
          };
        `;
        const blob = new Blob([workerCode], { type: 'application/javascript' });
        tickerWorker = new Worker(URL.createObjectURL(blob));
        tickerWorker.onmessage = (e) => {
          if (e.data.type === 'tick') {
            handleTick();
          }
        };
        tickerWorker.onerror = (err) => {
          console.warn('[AutoClicker Pro] Web Worker falló, cambiando a timer de respaldo:', err);
          tickerWorker = null;
          startFallbackTimer(state.intervalMs);
        };
      } catch (err) {
        console.warn('[AutoClicker Pro] CSP bloqueó Web Worker, usando timer de respaldo:', err);
        tickerWorker = null;
      }
    }
    return tickerWorker;
  }

  function startTicker(interval) {
    stopTicker();
    let worker = null;
    try {
      worker = getTickerWorker();
    } catch (e) {
      worker = null;
    }

    if (worker) {
      try {
        worker.postMessage({ cmd: 'start', interval });
        return;
      } catch (e) {
        console.warn('[AutoClicker Pro] Error en Worker postMessage:', e);
      }
    }

    startFallbackTimer(interval);
  }

  function startFallbackTimer(interval) {
    clearInterval(fallbackTimerId);
    fallbackTimerId = setInterval(() => {
      handleTick();
    }, Math.max(5, interval));
  }

  function stopTicker() {
    if (tickerWorker) {
      try {
        tickerWorker.postMessage({ cmd: 'stop' });
      } catch (e) {}
    }
    if (fallbackTimerId) {
      clearInterval(fallbackTimerId);
      fallbackTimerId = null;
    }
  }

  // ============================================================================
  // 6. INTERFAZ GRÁFICA EN SHADOW DOM
  // ============================================================================
  const hostDiv = document.createElement('div');
  hostDiv.id = 'autoclicker-pro-root';
  hostDiv.style.position = 'fixed';
  hostDiv.style.zIndex = '2147483647';
  hostDiv.style.top = '20px';
  hostDiv.style.right = '20px';
  hostDiv.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
  document.documentElement.appendChild(hostDiv);

  const shadow = hostDiv.attachShadow({ mode: 'open' });

  const pickerHighlighter = document.createElement('div');
  pickerHighlighter.style.position = 'fixed';
  pickerHighlighter.style.pointerEvents = 'none';
  pickerHighlighter.style.zIndex = '2147483646';
  pickerHighlighter.style.border = '2px dashed #4f46e5';
  pickerHighlighter.style.backgroundColor = 'rgba(79, 70, 229, 0.15)';
  pickerHighlighter.style.borderRadius = '4px';
  pickerHighlighter.style.transition = 'all 0.05s ease';
  pickerHighlighter.style.display = 'none';
  document.documentElement.appendChild(pickerHighlighter);

  const clickRipple = document.createElement('div');
  clickRipple.style.position = 'fixed';
  clickRipple.style.pointerEvents = 'none';
  clickRipple.style.zIndex = '2147483646';
  clickRipple.style.width = '24px';
  clickRipple.style.height = '24px';
  clickRipple.style.borderRadius = '50%';
  clickRipple.style.border = '2px solid #10b981';
  clickRipple.style.backgroundColor = 'rgba(16, 185, 129, 0.4)';
  clickRipple.style.transform = 'translate(-50%, -50%) scale(0)';
  clickRipple.style.transition = 'transform 0.18s ease-out, opacity 0.18s ease-out';
  clickRipple.style.opacity = '0';
  document.documentElement.appendChild(clickRipple);

  function triggerRipple(x, y) {
    clickRipple.style.left = `${x}px`;
    clickRipple.style.top = `${y}px`;
    clickRipple.style.transform = 'translate(-50%, -50%) scale(1)';
    clickRipple.style.opacity = '1';
    setTimeout(() => {
      clickRipple.style.transform = 'translate(-50%, -50%) scale(1.6)';
      clickRipple.style.opacity = '0';
    }, 120);
  }

  const styleEl = document.createElement('style');
  styleEl.textContent = `
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      font-size: 13px;
      user-select: none;
    }

    .widget-panel {
      width: 320px;
      background: #0f172a;
      border: 1px solid #334155;
      border-radius: 12px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.4);
      color: #f8fafc;
      overflow: hidden;
      display: flex;
      flex-direction: column;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(-8px); }
      to { opacity: 1; transform: translateY(0); }
    }

    .panel-header {
      background: #1e293b;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: grab;
      border-bottom: 1px solid #334155;
    }

    .panel-header:active {
      cursor: grabbing;
    }

    .title-area {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .app-icon {
      font-size: 16px;
    }

    .app-title {
      font-weight: 700;
      color: #ffffff;
      font-size: 13px;
    }

    .header-btns {
      display: flex;
      gap: 6px;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      font-size: 13px;
      padding: 2px 6px;
      border-radius: 4px;
      line-height: 1;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .icon-btn:hover {
      background: #334155;
      color: #ffffff;
    }

    .panel-body {
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      max-height: 80vh;
      overflow-y: auto;
    }

    .section {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .section-title {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #94a3b8;
    }

    .target-box {
      background: #1e293b;
      border: 1px solid #334155;
      border-radius: 8px;
      padding: 8px 10px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .target-preview {
      font-family: monospace;
      font-size: 11px;
      color: #38bdf8;
      background: #090d16;
      padding: 6px 8px;
      border-radius: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      border: 1px solid #1e293b;
    }

    .btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 8px 12px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }

    .btn-select {
      background: #3b82f6;
      color: white;
    }

    .btn-select:hover {
      background: #2563eb;
    }

    .btn-select.active {
      background: #eab308;
      color: #000;
      animation: pulse 1s infinite alternate;
    }

    @keyframes pulse {
      from { opacity: 0.8; }
      to { opacity: 1; }
    }

    .select-dropdown, .input-text {
      background: #1e293b;
      border: 1px solid #334155;
      color: #f8fafc;
      padding: 7px 10px;
      border-radius: 6px;
      outline: none;
      width: 100%;
    }

    .select-dropdown:focus, .input-text:focus {
      border-color: #6366f1;
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .row-between {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .preset-pills {
      display: flex;
      gap: 4px;
      margin-top: 4px;
      flex-wrap: wrap;
    }

    .pill {
      background: #1e293b;
      border: 1px solid #334155;
      color: #94a3b8;
      padding: 3px 8px;
      border-radius: 4px;
      font-size: 11px;
      cursor: pointer;
    }

    .pill:hover, .pill.active {
      background: #4f46e5;
      color: white;
      border-color: #6366f1;
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 12px;
      color: #cbd5e1;
      cursor: pointer;
    }

    .checkbox-label input[type="checkbox"] {
      accent-color: #6366f1;
      width: 15px;
      height: 15px;
      cursor: pointer;
    }

    .stats-card {
      background: #090d16;
      border: 1px solid #1e293b;
      border-radius: 8px;
      padding: 10px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
      text-align: center;
    }

    .stat-val {
      font-size: 18px;
      font-weight: 700;
      color: #10b981;
      font-variant-numeric: tabular-nums;
    }

    .stat-lbl {
      font-size: 10px;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .btn-action {
      padding: 12px;
      font-size: 14px;
      border-radius: 8px;
      letter-spacing: 0.5px;
    }

    .btn-start {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
    }

    .btn-start:hover {
      background: linear-gradient(135deg, #059669 0%, #047857 100%);
      transform: translateY(-1px);
    }

    .btn-stop {
      background: linear-gradient(135deg, #ef4444 0%, #dc2626 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
    }

    .btn-stop:hover {
      background: linear-gradient(135deg, #dc2626 0%, #b91c1c 100%);
      transform: translateY(-1px);
    }

    .footer-help {
      font-size: 11px;
      color: #64748b;
      text-align: center;
      line-height: 1.4;
      border-top: 1px solid #1e293b;
      padding-top: 8px;
      margin-top: 4px;
    }

    kbd {
      background: #1e293b;
      padding: 1px 4px;
      border-radius: 3px;
      border: 1px solid #334155;
      font-family: monospace;
      font-size: 10px;
      color: #cbd5e1;
    }

    .minimized-badge {
      display: none;
      background: #0f172a;
      border: 1px solid #4f46e5;
      box-shadow: 0 4px 14px rgba(79, 70, 229, 0.4);
      padding: 6px 12px;
      border-radius: 999px;
      color: white;
      cursor: pointer;
      align-items: center;
      gap: 8px;
    }

    .minimized-badge:hover {
      background: #1e293b;
    }

    .mini-status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #64748b;
    }

    .mini-status-dot.active {
      background: #10b981;
      box-shadow: 0 0 8px #10b981;
    }
  `;
  shadow.appendChild(styleEl);

  const widgetContainer = document.createElement('div');
  widgetContainer.innerHTML = `
    <!-- Mini Badge (cuando está minimizado) -->
    <div id="mini-badge" class="minimized-badge">
      <span id="mini-dot" class="mini-status-dot"></span>
      <span style="font-weight: 700; font-size: 12px;">AutoClicker</span>
      <span id="mini-counter" style="color: #38bdf8; font-family: monospace; font-size: 11px;">0</span>
    </div>

    <!-- Panel Completo -->
    <div id="main-panel" class="widget-panel">
      <!-- Barra superior arrastrable -->
      <div id="drag-handle" class="panel-header">
        <div class="title-area">
          <span class="app-icon">⚡</span>
          <span class="app-title">AutoClicker Pro</span>
        </div>
        <div class="header-btns">
          <button id="btn-minimize" class="icon-btn" title="Minimizar">_</button>
          <button id="btn-close" class="icon-btn" title="Cerrar (Alt+C)">✕</button>
        </div>
      </div>

      <div class="panel-body">
        <!-- SECCIÓN 1: Selección de qué cliquear -->
        <div class="section">
          <span class="section-title">1. ¿Qué cliquear?</span>
          <div class="target-box">
            <button id="btn-pick" class="btn btn-select">
              <span id="pick-icon">🎯</span>
              <span id="pick-text">Seleccionar Botón / Elemento</span>
            </button>
            <div id="target-desc" class="target-preview">
              (Ningún elemento seleccionado)
            </div>
            <div class="row-between" style="font-size: 11px; color: #94a3b8;">
              <label class="checkbox-label" style="font-size: 11px;">
                <input type="checkbox" id="chk-use-coords"> O usar coordenadas X,Y
              </label>
              <span id="coords-text" style="font-family: monospace; font-size: 10px;">X: 0, Y: 0</span>
            </div>
          </div>
        </div>

        <!-- SECCIÓN 2: Tipo de Click -->
        <div class="section">
          <span class="section-title">2. Tipo de Clic</span>
          <select id="sel-click-type" class="select-dropdown">
            <option value="left" selected>🖱️ Clic Izquierdo (Normal / Primario)</option>
            <option value="right">🖱️ Clic Derecho (Menú contextual)</option>
            <option value="middle">🖱️ Clic Central (Rueda / Auxiliar)</option>
            <option value="double">🖱️ Doble Clic Rápido</option>
          </select>
        </div>

        <!-- SECCIÓN 3: Velocidad / Intervalo -->
        <div class="section">
          <div class="row-between">
            <span class="section-title">3. Intervalo de Clic</span>
            <span style="font-size: 11px; color: #38bdf8; font-family: monospace;" id="cps-display">10.0 cps</span>
          </div>
          <div class="row">
            <input type="number" id="input-interval" class="input-text" value="100" min="5" max="60000" step="10">
            <span style="color: #94a3b8; font-size: 12px;">ms</span>
          </div>
          <div class="preset-pills">
            <span class="pill" data-ms="25">25ms (40/s)</span>
            <span class="pill active" data-ms="100">100ms (10/s)</span>
            <span class="pill" data-ms="250">250ms (4/s)</span>
            <span class="pill" data-ms="500">500ms (2/s)</span>
            <span class="pill" data-ms="1000">1s</span>
          </div>
          <label class="checkbox-label" style="margin-top: 4px;">
            <input type="checkbox" id="chk-jitter"> Variación aleatoria (±15% anti-detección)
          </label>
          <label class="checkbox-label" style="color: #34d399; font-weight: 600; margin-top: 2px;">
            <input type="checkbox" id="chk-background-safe" checked> 🛡️ Blindaje en segundo plano (Anti-pausa)
          </label>
        </div>

        <!-- SECCIÓN 4: Cantidad de Clics -->
        <div class="section">
          <span class="section-title">4. Cantidad de Clics</span>
          <div class="row-between" style="margin-bottom: 6px;">
            <label class="checkbox-label">
              <input type="checkbox" id="chk-infinite" checked>
              <strong>Infinito</strong> (hasta que tú lo detengas)
            </label>
          </div>
          <div id="goal-container" class="row" style="display: none;">
            <input type="number" id="input-goal" class="input-text" value="100" min="1" max="9999999">
            <span style="color: #94a3b8; font-size: 12px;">clics totales</span>
          </div>
        </div>

        <!-- CONTADOR Y ESTADÍSTICAS -->
        <div class="stats-card">
          <div>
            <div id="stat-count" class="stat-val">0</div>
            <div class="stat-lbl">Clics Dados</div>
          </div>
          <div>
            <div id="stat-time" class="stat-val" style="color: #38bdf8;">00:00</div>
            <div class="stat-lbl">Tiempo Activo</div>
          </div>
        </div>

        <!-- BOTÓN DE INICIO / PARADA -->
        <button id="btn-toggle-run" class="btn btn-action btn-start">
          <span id="run-icon">▶</span>
          <span id="run-text">INICIAR AUTOCLICKER</span>
        </button>

        <div class="footer-help">
          💡 Puedes cambiar de pestaña o minimizar Chrome: verás los clics sumarse en el título de la pestaña.
          <br>
          Presiona <kbd>Esc</kbd> para detener de emergencia.
        </div>
      </div>
    </div>
  `;
  shadow.appendChild(widgetContainer);

  const mainPanel = shadow.getElementById('main-panel');
  const miniBadge = shadow.getElementById('mini-badge');
  const miniDot = shadow.getElementById('mini-dot');
  const miniCounter = shadow.getElementById('mini-counter');
  const dragHandle = shadow.getElementById('drag-handle');
  const btnClose = shadow.getElementById('btn-close');
  const btnMinimize = shadow.getElementById('btn-minimize');
  const btnPick = shadow.getElementById('btn-pick');
  const pickText = shadow.getElementById('pick-text');
  const targetDesc = shadow.getElementById('target-desc');
  const chkUseCoords = shadow.getElementById('chk-use-coords');
  const coordsText = shadow.getElementById('coords-text');
  const selClickType = shadow.getElementById('sel-click-type');
  const inputInterval = shadow.getElementById('input-interval');
  const cpsDisplay = shadow.getElementById('cps-display');
  const presetPills = shadow.querySelectorAll('.pill');
  const chkJitter = shadow.getElementById('chk-jitter');
  const chkBackgroundSafe = shadow.getElementById('chk-background-safe');
  const chkInfinite = shadow.getElementById('chk-infinite');
  const goalContainer = shadow.getElementById('goal-container');
  const inputGoal = shadow.getElementById('input-goal');
  const statCount = shadow.getElementById('stat-count');
  const statTime = shadow.getElementById('stat-time');
  const btnToggleRun = shadow.getElementById('btn-toggle-run');
  const runIcon = shadow.getElementById('run-icon');
  const runText = shadow.getElementById('run-text');

  // Arrastre del panel
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  dragHandle.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = hostDiv.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const newX = Math.max(10, Math.min(window.innerWidth - 330, e.clientX - dragOffsetX));
    const newY = Math.max(10, Math.min(window.innerHeight - 100, e.clientY - dragOffsetY));
    hostDiv.style.left = `${newX}px`;
    hostDiv.style.top = `${newY}px`;
    hostDiv.style.right = 'auto';
  });

  window.addEventListener('mouseup', () => { isDragging = false; });

  btnMinimize.addEventListener('click', () => {
    state.minimized = true;
    mainPanel.style.display = 'none';
    miniBadge.style.display = 'flex';
  });

  miniBadge.addEventListener('click', () => {
    state.minimized = false;
    mainPanel.style.display = 'flex';
    miniBadge.style.display = 'none';
  });

  function togglePanelVisibility() {
    state.visible = !state.visible;
    hostDiv.style.display = state.visible ? 'block' : 'none';
  }
  btnClose.addEventListener('click', () => {
    state.visible = false;
    hostDiv.style.display = 'none';
  });
  window.__AUTOCLICKER_PRO_TOGGLE__ = togglePanelVisibility;

  function updateCachedCoordsElement() {
    if (state.targetCoords.x || state.targetCoords.y) {
      try {
        const el = document.elementFromPoint(state.targetCoords.x, state.targetCoords.y);
        if (el && !hostDiv.contains(el)) {
          state.cachedCoordsElement = el;
        }
      } catch (e) {}
    }
  }

  // Selector visual
  function startElementPicker() {
    state.pickingElement = true;
    btnPick.classList.add('active');
    pickText.textContent = 'Haz clic en cualquier elemento...';
    pickerHighlighter.style.display = 'block';

    const onPickerMove = (e) => {
      if (hostDiv.contains(e.target) || e.target === pickerHighlighter || e.target === clickRipple) {
        pickerHighlighter.style.display = 'none';
        return;
      }
      pickerHighlighter.style.display = 'block';
      const rect = e.target.getBoundingClientRect();
      pickerHighlighter.style.left = `${rect.left + window.scrollX}px`;
      pickerHighlighter.style.top = `${rect.top + window.scrollY}px`;
      pickerHighlighter.style.width = `${rect.width}px`;
      pickerHighlighter.style.height = `${rect.height}px`;
    };

    const onPickerClick = (e) => {
      if (hostDiv.contains(e.target)) return;
      e.preventDefault();
      e.stopPropagation();

      const el = e.target;
      state.targetElement = el;
      state.cachedCoordsElement = el;

      const rect = el.getBoundingClientRect();
      state.targetCoords = {
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };

      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : '';
      const classes = el.className && typeof el.className === 'string'
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
      const text = (el.innerText || el.value || el.title || el.getAttribute('aria-label') || '').trim().slice(0, 20);
      const textPreview = text ? ` "${text}"` : '';

      state.targetSelector = `<${tag}${id}${classes}>${textPreview}`;
      targetDesc.textContent = state.targetSelector;
      targetDesc.title = state.targetSelector;
      coordsText.textContent = `X: ${state.targetCoords.x}, Y: ${state.targetCoords.y}`;

      stopElementPicker();
    };

    const onPickerKey = (e) => {
      if (e.key === 'Escape') stopElementPicker();
    };

    function stopElementPicker() {
      state.pickingElement = false;
      btnPick.classList.remove('active');
      pickText.textContent = 'Cambiar Elemento';
      pickerHighlighter.style.display = 'none';
      window.removeEventListener('mousemove', onPickerMove, true);
      window.removeEventListener('click', onPickerClick, true);
      window.removeEventListener('keydown', onPickerKey, true);
    }

    window.addEventListener('mousemove', onPickerMove, true);
    window.addEventListener('click', onPickerClick, true);
    window.addEventListener('keydown', onPickerKey, true);
  }

  btnPick.addEventListener('click', () => {
    if (state.pickingElement) return;
    startElementPicker();
  });

  chkUseCoords.addEventListener('change', (e) => {
    state.targetMode = e.target.checked ? 'coords' : 'element';
    updateCachedCoordsElement();
  });

  selClickType.addEventListener('change', (e) => {
    state.clickType = e.target.value;
  });

  function updateCPS() {
    const ms = parseInt(inputInterval.value, 10) || 100;
    const cps = (1000 / ms).toFixed(1);
    cpsDisplay.textContent = `${cps} cps`;
    state.intervalMs = ms;
  }

  inputInterval.addEventListener('input', () => {
    updateCPS();
    presetPills.forEach(p => p.classList.remove('active'));
  });

  presetPills.forEach(pill => {
    pill.addEventListener('click', () => {
      presetPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      inputInterval.value = pill.getAttribute('data-ms');
      updateCPS();
    });
  });

  chkJitter.addEventListener('change', (e) => {
    state.randomJitter = e.target.checked;
  });

  chkBackgroundSafe.addEventListener('change', (e) => {
    state.keepAliveBackground = e.target.checked;
  });

  chkInfinite.addEventListener('change', (e) => {
    state.isInfinite = e.target.checked;
    goalContainer.style.display = state.isInfinite ? 'none' : 'flex';
  });

  inputGoal.addEventListener('input', (e) => {
    state.totalClicksGoal = parseInt(e.target.value, 10) || 100;
  });

  // Simulación de Clics
  function simulateClick(targetEl, clickX, clickY, type) {
    if (!targetEl) return;
    const el = targetEl;

    let cx = clickX;
    let cy = clickY;
    if (cx === undefined || cy === undefined) {
      try {
        const rect = el.getBoundingClientRect();
        cx = Math.round(rect.left + rect.width / 2);
        cy = Math.round(rect.top + rect.height / 2);
      } catch (e) {
        cx = 0;
        cy = 0;
      }
    }

    if (!realTabIsHidden) {
      triggerRipple(cx, cy);
    }

    let buttonCode = 0;
    let buttonsCode = 1;
    if (type === 'right') {
      buttonCode = 2;
      buttonsCode = 2;
    } else if (type === 'middle') {
      buttonCode = 1;
      buttonsCode = 4;
    }

    const mouseInit = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: cx,
      clientY: cy,
      screenX: cx + (window.screenX || 0),
      screenY: cy + (window.screenY || 0),
      button: buttonCode,
      buttons: buttonsCode
    };

    try {
      el.dispatchEvent(new PointerEvent('pointerdown', mouseInit));
      el.dispatchEvent(new MouseEvent('mousedown', mouseInit));
      el.dispatchEvent(new PointerEvent('pointerup', mouseInit));
      el.dispatchEvent(new MouseEvent('mouseup', mouseInit));

      if (type === 'left') {
        el.dispatchEvent(new MouseEvent('click', mouseInit));
        if (typeof el.click === 'function') {
          el.click();
        }
      } else if (type === 'right') {
        el.dispatchEvent(new MouseEvent('contextmenu', mouseInit));
      } else if (type === 'middle') {
        el.dispatchEvent(new MouseEvent('auxclick', mouseInit));
      } else if (type === 'double') {
        el.dispatchEvent(new MouseEvent('click', mouseInit));
        if (typeof el.click === 'function') el.click();
        el.dispatchEvent(new MouseEvent('dblclick', mouseInit));
      }
    } catch (err) {
      console.warn('[AutoClicker Pro] Error en simulateClick:', err);
    }
  }

  // Ticker callback
  function handleTick() {
    if (!state.running) return;

    if (!state.isInfinite && state.clicksCount >= state.totalClicksGoal) {
      stopAutoClicker();
      return;
    }

    if (state.targetMode === 'coords') {
      let el = null;
      if (!realTabIsHidden) {
        try {
          el = document.elementFromPoint(state.targetCoords.x, state.targetCoords.y);
          if (el && !hostDiv.contains(el)) state.cachedCoordsElement = el;
        } catch (e) {}
      }
      if (!el && state.cachedCoordsElement && document.contains(state.cachedCoordsElement)) {
        el = state.cachedCoordsElement;
      }
      if (!el && state.targetElement && document.contains(state.targetElement)) {
        el = state.targetElement;
      }
      simulateClick(el || document.body, state.targetCoords.x, state.targetCoords.y, state.clickType);
    } else {
      let target = state.targetElement;
      if (!target || !document.contains(target)) {
        if (!realTabIsHidden) {
          try {
            target = document.elementFromPoint(state.targetCoords.x, state.targetCoords.y);
            if (target && !hostDiv.contains(target)) state.targetElement = target;
          } catch (e) {}
        }
      }
      if (target) {
        simulateClick(target, state.targetCoords.x, state.targetCoords.y, state.clickType);
      } else if (state.targetCoords.x || state.targetCoords.y) {
        simulateClick(state.cachedCoordsElement || document.body, state.targetCoords.x, state.targetCoords.y, state.clickType);
      }
    }

    state.clicksCount++;
    statCount.textContent = state.clicksCount.toLocaleString();
    miniCounter.textContent = state.clicksCount.toLocaleString();
    updateTabTitle(state.clicksCount);
  }

  let timerInterval = null;
  function updateElapsedTime() {
    if (!state.startTime) return;
    const elapsedSecs = Math.floor((Date.now() - state.startTime) / 1000);
    const mins = String(Math.floor(elapsedSecs / 60)).padStart(2, '0');
    const secs = String(elapsedSecs % 60).padStart(2, '0');
    statTime.textContent = `${mins}:${secs}`;
  }

  function startAutoClicker() {
    if (!state.targetElement && state.targetCoords.x === 0 && state.targetCoords.y === 0) {
      alert('Por favor, selecciona primero un botón o elemento con "🎯 Seleccionar Botón / Elemento".');
      return;
    }

    updateCachedCoordsElement();

    state.running = true;
    state.clicksCount = 0;
    state.startTime = Date.now();
    statCount.textContent = '0';
    statTime.textContent = '00:00';

    btnToggleRun.classList.remove('btn-start');
    btnToggleRun.classList.add('btn-stop');
    runIcon.textContent = '⏹';
    runText.textContent = 'DETENER AUTOCLICKER';
    miniDot.classList.add('active');

    btnPick.disabled = true;
    inputInterval.disabled = true;
    selClickType.disabled = true;

    let currentInterval = state.intervalMs;
    if (state.randomJitter) {
      const variation = (Math.random() * 0.3 - 0.15) * currentInterval;
      currentInterval = Math.max(5, Math.round(currentInterval + variation));
    }

    // Activar blindaje para segundo plano
    if (state.keepAliveBackground) {
      startBackgroundAudioKeepAlive();
      enableAntiPause();
    }

    startTicker(currentInterval);

    clearInterval(timerInterval);
    timerInterval = setInterval(updateElapsedTime, 1000);
  }

  function stopAutoClicker() {
    state.running = false;
    stopTicker();
    stopBackgroundAudioKeepAlive();
    disableAntiPause();
    restoreTabTitle();

    clearInterval(timerInterval);

    btnToggleRun.classList.remove('btn-stop');
    btnToggleRun.classList.add('btn-start');
    runIcon.textContent = '▶';
    runText.textContent = 'INICIAR AUTOCLICKER';
    miniDot.classList.remove('active');

    btnPick.disabled = false;
    inputInterval.disabled = false;
    selClickType.disabled = false;
  }

  btnToggleRun.addEventListener('click', () => {
    if (state.running) stopAutoClicker();
    else startAutoClicker();
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.running) stopAutoClicker();
    if (e.altKey && (e.key === 'c' || e.key === 'C')) togglePanelVisibility();
  }, true);

  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'toggle-panel') {
      togglePanelVisibility();
      sendResponse({ visible: state.visible });
    }
    return true;
  });

  console.log('%c[AutoClicker Pro]%c Inicializado con blindaje en segundo plano. Presiona Alt+C.', 'color: #4f46e5; font-weight: bold;', 'color: inherit;');
})();
