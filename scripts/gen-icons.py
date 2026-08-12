#!/usr/bin/env python3
"""Generate PWA icons (192/512 PNG) using only stdlib."""
import os, struct, zlib

OUT_DIR = os.path.join(os.path.dirname(__file__), '..', 'public', 'icons')
os.makedirs(OUT_DIR, exist_ok=True)

BG = (37, 99, 235)  # blue
FG = (255, 255, 255)

FONT = {
    'F': ['11111','10000','10000','11110','10000','10000','10000'],
    'U': ['10001','10001','10001','10001','10001','10001','01110'],
    'N': ['10001','11001','10101','10101','10011','10001','10001'],
    'C': ['01110','10001','10000','10000','10000','10001','01110'],
}

def set_px(buf, w, h, x, y, rgb):
    if 0 <= x < w and 0 <= y < h:
        idx = y * (1 + w * 3) + 1 + x * 3
        buf[idx:idx+3] = bytes(rgb)

def render(buf, w, h, text, scale):
    chars = list(text)
    char_w = 5 * scale
    gap = 1 * scale
    total_w = len(chars) * char_w + (len(chars) - 1) * gap
    start_x = (w - total_w) // 2
    start_y = (h - 7 * scale) // 2
    for ci, ch in enumerate(chars):
        g = FONT.get(ch)
        if not g: continue
        ox = start_x + ci * (char_w + gap)
        for y in range(7):
            for x in range(5):
                if g[y][x] == '1':
                    for dy in range(scale):
                        for dx in range(scale):
                            set_px(buf, w, h, ox + x*scale + dx, start_y + y*scale + dy, FG)

def make_png(w, h, bg):
    stride = 1 + w * 3
    raw = bytearray(stride * h)
    for y in range(h):
        raw[y * stride] = 0  # filter: None
        for x in range(w):
            set_px(raw, w, h, x, y, bg)
    render(raw, w, h, 'FUNC', max(1, w // 32))
    return make_png_bytes(w, h, bytes(raw))

def make_png_bytes(w, h, raw):
    def chunk(typ, data):
        return struct.pack('>I', len(data)) + typ + data + struct.pack('>I', zlib.crc32(typ + data) & 0xFFFFFFFF)
    sig = b'\x89PNG\r\n\x1a\n'
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    idat = zlib.compress(bytes(raw))
    return sig + chunk(b'IHDR', ihdr) + chunk(b'IDAT', idat) + chunk(b'IEND', b'')

for s in (192, 512):
    data = make_png(s, s, BG)
    out = os.path.join(OUT_DIR, f'icon-{s}.png')
    with open(out, 'wb') as f:
        f.write(data)
    print(f'wrote {out} ({len(data)} bytes)')
