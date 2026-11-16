// Generates build/icon.png (512px) and build/icon.ico from scratch: an orange fruit slice.
// Pure Node, no dependencies. Run: node build/make-icon.mjs
import { deflateSync } from 'node:zlib'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

function crc32(buf) {
  let c
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function png(size, pixel) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      const [r, g, b, a] = pixel((x + 0.5) / size, (y + 0.5) / size, 1 / size)
      raw.set([r, g, b, a], y * (size * 4 + 1) + 1 + x * 4)
    }
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ])
}

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))
const RIND = [232, 106, 16]
const PITH = [255, 243, 224]
const FLESH = [255, 154, 31]
const FLESH_DARK = [244, 124, 10]

// Coverage-based edge so small sizes stay smooth.
function edge(dist, px) {
  return Math.min(1, Math.max(0, 0.5 - dist / px))
}

function pixel(x, y, px) {
  const dx = x - 0.5
  const dy = y - 0.5
  const r = Math.hypot(dx, dy)
  let color
  let alpha = edge(r - 0.46, px)
  if (alpha === 0) return [0, 0, 0, 0]
  if (r > 0.4) color = RIND
  else if (r > 0.37) color = PITH
  else {
    // 8 segments separated by thin pith walls radiating from the center.
    const segments = 8
    const angle = (Math.atan2(dy, dx) + Math.PI * 2) % (Math.PI * 2)
    const slice = (Math.PI * 2) / segments
    const local = (angle % slice) - slice / 2
    const wall = r * Math.sin(Math.abs(local)) > 0 && r * Math.sin(slice / 2 - Math.abs(local)) < 0.014
    if (r < 0.04 || wall) color = PITH
    else color = mix(FLESH, FLESH_DARK, Math.min(1, r / 0.37) ** 2)
  }
  return [...color, Math.round(alpha * 255)]
}

const sizes = [16, 24, 32, 48, 64, 128, 256]
const images = sizes.map((s) => png(s, pixel))
writeFileSync(join(here, 'icon.png'), png(512, pixel))

const header = Buffer.alloc(6)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(sizes.length, 4)
const dir = Buffer.alloc(16 * sizes.length)
let offset = header.length + dir.length
sizes.forEach((s, i) => {
  dir[i * 16] = s === 256 ? 0 : s
  dir[i * 16 + 1] = s === 256 ? 0 : s
  dir.writeUInt16LE(1, i * 16 + 4)
  dir.writeUInt16LE(32, i * 16 + 6)
  dir.writeUInt32LE(images[i].length, i * 16 + 8)
  dir.writeUInt32LE(offset, i * 16 + 12)
  offset += images[i].length
})
writeFileSync(join(here, 'icon.ico'), Buffer.concat([header, dir, ...images]))
console.log('wrote build/icon.png and build/icon.ico')
