# ⚡ AutoClicker Pro para Google Chrome

[![Manifest V3](https://img.shields.io/badge/Chrome%20Extension-Manifest%20V3-4285F4?logo=googlechrome&logoColor=white)](manifest.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Chrome%20%7C%20Edge%20%7C%20Brave-blue)](manifest.json)
[![Status](https://img.shields.io/badge/Status-Production%20Ready-success)](#)

Un autoclicker avanzado para navegador web diseñado para **hacer clics continuos sin tomar el control del cursor de Windows y sin detenerse cuando cambias de pestaña o minimizas el navegador**.

---

## 🎯 ¿Qué lo hace diferente?

| Autoclickers de Escritorio (AutoHotkey, OP AutoClicker, etc.) | ⚡ AutoClicker Pro (Esta extensión) |
| :--- | :--- |
| ❌ Bloquea y mueve el cursor físico de Windows. | ✅ **Cursor 100% libre:** Envía eventos sintéticos directamente al DOM. Puedes usar Word, Discord o jugar en Windows mientras hace clics. |
| ❌ Hace clics accidentales si cambias de ventana. | ✅ **Aislado a la pestaña:** Solo afecta al elemento o coordenadas seleccionadas en esa página web específica. |
| ❌ No discrimina elementos web con facilidad. | ✅ **Selector visual inteligente:** Apunta y haz clic sobre cualquier botón o enlace para seleccionarlo. |
| ❌ Chrome suspende pestañas en segundo plano. | ✅ **Cuádruple blindaje anti-suspensión:** No se congela ni se ralentiza al cambiar de pestaña. |

---

## 🛡️ Cuádruple Blindaje en Segundo Plano

Por defecto, los navegadores modernos congelan o reducen la frecuencia de las pestañas inactivas a 1 tick por segundo (o las suspenden tras unos minutos), y muchos sitios o juegos web pausan su lógica cuando detectan pérdida de foco. **AutoClicker Pro** resuelve esto con cuatro capas de protección:

1. **Web Audio Keep-Alive (Exención oficial de Chrome):** Al iniciar, activa un nodo inaudible en `AudioContext`. En el motor Chromium, las pestañas que reproducen audio son clasificadas como activas y quedan **exentas del throttling y congelamiento en segundo plano**.
2. **Sistema Anti-Pausa (Spoofing de Visibilidad):** Intercepta los eventos `blur`, `focusout` y `visibilitychange`, y enmascara `document.hidden = false` y `document.hasFocus() = true` para que la página crea que sigue en primer plano.
3. **Shim de `requestAnimationFrame`:** Chrome suspende las animaciones RAF en pestañas ocultas. Este script las redirige a un temporizador activo para que frameworks como React, Vue o motores Canvas sigan actualizando estados.
4. **Contador en Vivo en la Pestaña:** El título de la pestaña se actualiza en tiempo real:  
   `([Clicks]) ⚡ [Título de la página]`  
   Puedes mirar tu barra de pestañas y ver los clics aumentar sin necesidad de cambiar a ella.

---

## ✨ Características Principales

* **🎯 Selector Visual:** Haz clic en *"Seleccionar Botón / Elemento"* y toca cualquier elemento del DOM para convertirlo en el objetivo.
* **📍 Modo Coordenadas X, Y:** Soporte para hacer clic en coordenadas exactas si la página usa `<canvas>` o juegos HTML5.
* **🖱️ Tipos de Clic Disponibles:**
  * Clic Izquierdo (Normal / Primario)
  * Clic Derecho (Menú contextual)
  * Clic Central (Rueda / Auxiliar)
  * Doble Clic Rápido
* **♾️ Modo Infinito o Meta Numérica:** Configura un número específico de clics (ej. 500) o déjalo en infinito hasta que tú lo detengas.
* **⏱️ Intervalo y Velocidad:** Selector de milisegundos con accesos rápidos (25ms = 40 CPS, 100ms = 10 CPS, 250ms, 500ms, 1s).
* **🎲 Jitter Anti-Detección:** Variación aleatoria del ±15% en los intervalos para simular comportamiento humano y evitar filtros de bots.
* **🪟 Interfaz Flotante en Shadow DOM:** Totalmente aislada del CSS de la página para que nada rompa su diseño. Se puede arrastrar por la pantalla o minimizar a una pequeña insignia.
* **🛑 Parada de Emergencia:** Presiona <kbd>Esc</kbd> en cualquier momento para detener los clics al instante.

---

## ⌨️ Atajos de Teclado

| Atajo | Acción |
| :---: | :--- |
| <kbd>Alt</kbd> + <kbd>C</kbd> | Mostrar u ocultar el panel flotante del AutoClicker |
| <kbd>Esc</kbd> | **Parada de emergencia:** Detener los clics de inmediato |

---

## 🚀 Instalación y Uso

### Opción 1: Como Extensión de Chrome (Recomendado)

1. Clona o descarga este repositorio en tu computadora.
2. Abre Google Chrome y navega a `chrome://extensions`.
3. En la esquina superior derecha, activa el interruptor **"Modo de desarrollador"**.
4. Haz clic en el botón **"Cargar descomprimida"** (arriba a la izquierda).
5. Selecciona la carpeta de este proyecto.
6. ¡Listo! Presiona <kbd>Alt</kbd> + <kbd>C</kbd> o haz clic en el icono del rayo ⚡ en la barra de extensiones.

### Opción 2: Sin Instalar Nada (Consola F12 / Bookmarklet)

Si estás en una computadora donde no puedes instalar extensiones:
1. En la página donde quieras usarlo, presiona <kbd>F12</kbd> y ve a la pestaña **Consola** (Console).
2. Copia todo el contenido de [`autoclicker-bookmarklet.js`](autoclicker-bookmarklet.js) y pégalo en la consola.
3. Presiona <kbd>Enter</kbd> y el panel flotante se abrirá inmediatamente.

---

## 🧪 Cómo Probarlo Localmente

El repositorio incluye un archivo interactivo [`test.html`](test.html) para pruebas:

1. Abre el archivo `test.html` en Chrome haciendo doble clic en él.
2. Presiona <kbd>Alt</kbd> + <kbd>C</kbd> para abrir el AutoClicker.
3. Haz clic en **"🎯 Seleccionar Botón / Elemento"** y toca el botón *"👆 ¡Haz Clic Aquí!"*.
4. Haz clic en **"▶ INICIAR AUTOCLICKER"**.
5. Cambia a otra pestaña o minimiza Chrome: verás los números subir en el título de la pestaña y, al volver, verás el registro en el contador de clics en segundo plano.

---

## 📁 Estructura del Proyecto

```text
├── manifest.json               # Configuración Manifest V3 para Chrome
├── background.js               # Service Worker para atajos y mensajería
├── content.js                  # Motor inyectado con Shadow DOM y Web Worker
├── popup.html                  # Popup de la barra de extensiones
├── popup.css                   # Estilos del popup
├── popup.js                    # Lógica del popup
├── autoclicker-bookmarklet.js  # Versión autónoma para consola F12
├── generate_icons.py           # Generador nativo de iconos PNG (sin librerías externas)
├── icons/                      # Iconos de 16x16, 48x48 y 128x128
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── test.html                   # Entorno de pruebas interactivo
├── LICENSE                     # Licencia MIT
└── README.md                   # Documentación del proyecto
```

---

## 📄 Licencia

Este proyecto está bajo la Licencia [MIT](LICENSE). Puedes usarlo, modificarlo y distribuirlo libremente.
