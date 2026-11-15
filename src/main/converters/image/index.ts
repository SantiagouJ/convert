import { randomUUID } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { Converter, OptionSpec } from '@shared/types'
import { runFfmpeg } from '../../lib/ffmpeg'

/**
 * Notes on what the bundled sharp build supports (verified):
 * - reads jpg png webp tiff gif svg avif; writes jpg png webp tiff gif avif
 * - no HEIC (libheif ships without HEVC), no BMP, no ICO
 * BMP and ICO input is decoded by ffmpeg, BMP output is encoded by ffmpeg,
 * ICO output is written by hand (an ICO can embed a PNG).
 */
// Windows keeps cached files locked, which would block the user from moving or deleting them.
sharp.cache(false)

const SHARP_IN = ['jpg', 'png', 'webp', 'tiff', 'gif', 'svg', 'avif']
const FFMPEG_IN = ['bmp', 'ico']
const OUT = ['jpg', 'png', 'webp', 'avif', 'tiff', 'bmp', 'gif', 'ico']
const LOSSY = ['jpg', 'webp', 'avif']

function options(to: string): OptionSpec[] {
  if (!LOSSY.includes(to)) return []
  return [{ key: 'quality', label: 'Quality', type: 'number', min: 1, max: 100, step: 1, default: 85, unit: '%' }]
}

function friendly(error: unknown): Error {
  if (error instanceof Error && /cancelled|abort/i.test(error.message)) return error
  return new Error('This image could not be read or converted')
}

/** Wraps an ICO header around a PNG; sizes above 256 are scaled down. */
function icoFromPng(png: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(22)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(1, 4)
  header[6] = width >= 256 ? 0 : width
  header[7] = height >= 256 ? 0 : height
  header.writeUInt16LE(1, 10) // planes
  header.writeUInt16LE(32, 12) // bit depth
  header.writeUInt32LE(png.length, 14)
  header.writeUInt32LE(22, 18)
  return Buffer.concat([header, png])
}

export const converters: Converter[] = [
  {
    id: 'image.sharp',
    category: 'image',
    from: [...SHARP_IN, ...FFMPEG_IN],
    to: OUT,
    options,
    async convert({ inputPath, outputPath, from, to, options, signal, onProgress }) {
      const quality = Number(options.quality ?? 85)
      try {
        // Stage 1: get a decodable source (ffmpeg for BMP/ICO).
        let source: Sharp
        if (FFMPEG_IN.includes(from)) {
          const chunks = await decodeWithFfmpeg(inputPath, signal)
          source = sharp(chunks, { failOn: 'none' })
        } else {
          // Animated GIF/WebP keep only the first frame unless the target is animated-capable.
          source = sharp(inputPath, { animated: from === 'gif' && to === 'gif', density: from === 'svg' ? 192 : undefined })
        }
        onProgress(0.3)
        signal.throwIfAborted()
        source = source.rotate() // honor EXIF orientation

        if (to === 'jpg' || to === 'bmp') source = source.flatten({ background: '#ffffff' })

        if (to === 'bmp') {
          const png = await source.png().toBuffer()
          await runFfmpeg(['-y', '-f', 'image2pipe', '-c:v', 'png', '-i', '-', '-frames:v', '1', '-pix_fmt', 'bgr24', outputPath], {
            signal,
            stdin: png
          })
        } else if (to === 'ico') {
          const { data, info } = await source
            .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
            .png()
            .toBuffer({ resolveWithObject: true })
          await writeFile(outputPath, icoFromPng(data, info.width, info.height))
        } else if (to === 'jpg') {
          await source.jpeg({ quality, mozjpeg: true }).toFile(outputPath)
        } else if (to === 'png') {
          await source.png().toFile(outputPath)
        } else if (to === 'webp') {
          await source.webp({ quality }).toFile(outputPath)
        } else if (to === 'avif') {
          await source.avif({ quality }).toFile(outputPath)
        } else if (to === 'tiff') {
          await source.tiff({ compression: 'lzw' }).toFile(outputPath)
        } else if (to === 'gif') {
          await source.gif().toFile(outputPath)
        }
        signal.throwIfAborted()
        onProgress(1)
      } catch (error) {
        throw friendly(error)
      }
    }
  }
]

/** Decodes any image ffmpeg understands into a PNG buffer. */
async function decodeWithFfmpeg(inputPath: string, signal: AbortSignal): Promise<Buffer> {
  const tmp = join(tmpdir(), `convert-${randomUUID()}.png`)
  try {
    // For multi-size ICOs ffmpeg exposes each as a stream; map the first video stream.
    await runFfmpeg(['-y', '-i', inputPath, '-map', '0:v:0', '-frames:v', '1', tmp], { signal })
    return await readFile(tmp)
  } finally {
    await rm(tmp, { force: true }).catch(() => {})
  }
}
