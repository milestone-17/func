#!/usr/bin/env node
/**
 * 生成 PWA 图标占位 (192/512 PNG, 纯色 + 中心文本)
 * - 不依赖第三方库, 只用 Node 内置 zlib + buffer
 * - 颜色: 蓝色背景 + 白色 "FUNC" 文字 (用 5x7 点阵手绘, 非专业字体)
 */
const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

const OUT_DIR = path.join(__dirname, '..', 'public')
fs.mkdirSync(OUT_DIR, { recursive: true })

// 5x7 点阵字模 (只够"FUNC"4 字符 + 数字)
const FONT = {
  F: ['11111','10000','10000','11110','10000','10000','10000'],
  U: ['10001','10001','10001','10001','10001','10001','01110'],
  N: ['10001','11001','10101','10101','10011','10001','10001'],
  C: ['01110','10001','10000','10000','10000','10001','01110']
}
const FG = [255, 255, 255]
const BG = [37, 99, 235] // 蓝

function renderText(buf, w, h, text, scale) {
  const chars = text.split('')
  const charW = 5 * scale
  const gap = 1 * scale
  const totalW = chars.length * charW + (chars.length - 1) * gap
  const startX = Math.floor((w - totalW) / 2)
  const startY = Math.floor((h - 7 * scale) / 2)
  for (let ci = 0; ci < chars.length; ci++) {
    const glyph = FONT[chars[ci]]
    if (!glyph) continue
    const ox = startX + ci * (charW + gap)
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 5; x++) {
        if (glyph[y][x] === '1') {
          for (let dy = 0; dy < scale; dy++) {
            for (let dx = 0; dx < scale; dx++) {
              const px = ox + x * scale + dx
              const py = startY + y * scale + dy
              setPx(buf, w, h, px, py, FG)
            }
          }
        }
      }
    }
  }
}

function setPx(buf, w, h, x, y, [r, g, b]) {
  if (x < 0 || x >= w || y < 0 || y >= h) return
  // row y: 1 filter byte + w*3 RGB
  const rowStart = y * (1 + w * 3)
  const idx = rowStart + 1 + x * 3
  buf[idx] = r
  buf[idx + 1] = g
  buf[idx + 2] = b
}

function makePng(w, h, bg) {
  const stride = 1 + w * 3
  const raw = Buffer.alloc(stride * h)
  for (let y = 0; y < h; y++) {
    raw[y * stride] = 0 // filter: None
    for (let x = 0; x < w; x++) setPx(raw, w, h, x, y, bg)
  }
  // 居中文字
  renderText(raw, w, h, 'FUNC', Math.max(1, Math.floor(w / 32)))
  const idat = zlib.deflateSync(raw)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', Buffer.concat([
      u32(w), u32(h),
      Buffer.from([8, 2, 0, 0, 0]) // 8bit RGB
    ])),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

function chunk(type, data) {
  const len = u32(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crc = u32(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crc])
}

function u32(n) {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n, 0)
  return b
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
    }
    t[n] = c >>> 0
  }
  return t
})()
function crc32(buf) {
  let c = 0xFFFFFFFF
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8)
  }
  return (c ^ 0xFFFFFFFF) >>> 0
}

// 生成 192/512 PWA 图标 + 180 apple-touch-icon
const sizes = [
  { size: 192, name: 'icon-192.png' },
  { size: 512, name: 'icon-512.png' },
  { size: 180, name: 'apple-touch-icon.png' }
]
for (const { size, name } of sizes) {
  const buf = makePng(size, size, BG)
  const out = path.join(OUT_DIR, name)
  fs.writeFileSync(out, buf)
  console.log('wrote', out, buf.length, 'bytes')
}
