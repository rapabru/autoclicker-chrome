import os
import struct
import zlib

def create_png(width, height, draw_func):
    raw_rows = []
    for y in range(height):
        row = bytearray([0])
        for x in range(width):
            r, g, b, a = draw_func(x, y, width, height)
            row.extend([r, g, b, a])
        raw_rows.append(bytes(row))
    
    raw_data = b"".join(raw_rows)
    compressed = zlib.compress(raw_data)
    
    png = bytearray(b"\x89PNG\r\n\x1a\n")
    
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)
    ihdr_crc = zlib.crc32(b"IHDR" + ihdr_data) & 0xffffffff
    png.extend(struct.pack(">I", len(ihdr_data)) + b"IHDR" + ihdr_data + struct.pack(">I", ihdr_crc))
    
    idat_crc = zlib.crc32(b"IDAT" + compressed) & 0xffffffff
    png.extend(struct.pack(">I", len(compressed)) + b"IDAT" + compressed + struct.pack(">I", idat_crc))
    
    iend_crc = zlib.crc32(b"IEND") & 0xffffffff
    png.extend(struct.pack(">I", 0) + b"IEND" + struct.pack(">I", iend_crc))
    
    return bytes(png)

def draw_icon(x, y, w, h):
    cx, cy = w / 2, h / 2
    dx = x - cx
    dy = y - cy
    dist = (dx*dx + dy*dy) ** 0.5
    radius = w * 0.44

    if dist <= radius:
        t = (x + y) / (w + h)
        r = int(79 * (1 - t) + 124 * t)
        g = int(70 * (1 - t) + 58 * t)
        b = int(229 * (1 - t) + 237 * t)
        
        inner_r = radius * 0.55
        target_center_r = radius * 0.22
        
        is_crosshair = (abs(dx) <= max(1, w*0.06) or abs(dy) <= max(1, h*0.06)) and dist <= radius * 0.85
        is_center = dist <= target_center_r
        is_ring = abs(dist - inner_r) <= max(1, w*0.07)
        
        if is_center or is_ring or is_crosshair:
            return 255, 255, 255, 255
        
        return r, g, b, 255
    elif dist <= radius + 1:
        alpha = int(255 * (1 - (dist - radius)))
        return 79, 70, 229, max(0, min(255, alpha))
    else:
        return 0, 0, 0, 0

os.makedirs("icons", exist_ok=True)
for size in [16, 48, 128]:
    png_data = create_png(size, size, draw_icon)
    with open(f"icons/icon-{size}.png", "wb") as f:
        f.write(png_data)
    print(f"Generated icons/icon-{size}.png")
