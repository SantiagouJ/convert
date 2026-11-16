import type { Converter, OptionSpec } from '@shared/types'
import { probeDuration, runFfmpeg } from '../../lib/ffmpeg'
import { audioEncodeArgs, bitrateOption } from '../audio'

const VIDEO = ['mp4', 'mov', 'mkv', 'webm', 'avi', 'wmv']
const AUDIO_OUT = ['mp3', 'm4a', 'wav']
const PRESETS = {
  high: { crf: 20, vpx: 28, qscale: 3 },
  balanced: { crf: 23, vpx: 33, qscale: 5 },
  small: { crf: 28, vpx: 40, qscale: 9 }
} as const

function heightOption(def: number): OptionSpec {
  return {
    key: 'maxHeight',
    label: 'Max height (0 = original)',
    type: 'number',
    min: 0,
    max: 4320,
    step: 2,
    default: def,
    unit: 'px'
  }
}

function options(to: string): OptionSpec[] {
  if (AUDIO_OUT.includes(to)) return bitrateOption(to)
  if (to === 'gif') return [heightOption(480)]
  return [
    {
      key: 'quality',
      label: 'Quality',
      type: 'select',
      default: 'balanced',
      choices: [
        { value: 'high', label: 'High quality' },
        { value: 'balanced', label: 'Balanced' },
        { value: 'small', label: 'Small file' }
      ]
    },
    heightOption(0)
  ]
}

/** Never upscales; -2 keeps the width even, which H.264 needs. */
function scaleFilter(maxHeight: number): string | undefined {
  return maxHeight > 0 ? `scale=-2:'min(${Math.round(maxHeight)},ih)'` : undefined
}

function videoArgs(to: string, preset: (typeof PRESETS)[keyof typeof PRESETS]): string[] {
  switch (to) {
    case 'mp4':
    case 'mov':
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart']
    case 'mkv':
      return ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(preset.crf), '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '160k']
    case 'webm':
      return ['-c:v', 'libvpx', '-crf', String(preset.vpx), '-b:v', '2M', '-deadline', 'good', '-cpu-used', '4',
        '-c:a', 'libvorbis', '-b:a', '128k']
    case 'avi':
      return ['-c:v', 'mpeg4', '-q:v', String(preset.qscale), '-c:a', 'libmp3lame', '-b:a', '192k']
    default: // wmv
      return ['-c:v', 'wmv2', '-q:v', String(preset.qscale), '-c:a', 'wmav2', '-b:a', '192k']
  }
}

export const converters: Converter[] = [
  {
    id: 'video.ffmpeg',
    category: 'video',
    from: VIDEO,
    to: [...VIDEO, 'gif', ...AUDIO_OUT],
    options,
    async convert({ inputPath, outputPath, to, options, signal, onProgress }) {
      const durationSec = await probeDuration(inputPath, signal)
      const progress = { signal, durationSec, onProgress }
      const scale = scaleFilter(Number(options.maxHeight ?? 0))

      if (AUDIO_OUT.includes(to)) {
        await runFfmpeg(
          ['-y', '-i', inputPath, '-vn', ...audioEncodeArgs(to, Number(options.bitrate ?? 192)), outputPath],
          progress
        )
      } else if (to === 'gif') {
        const filters = `fps=12,${scale ?? "scale=-2:'min(480,ih)'"}`
        await runFfmpeg(
          [
            '-y', '-i', inputPath, '-an',
            '-filter_complex',
            `[0:v]${filters},split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=5`,
            '-loop', '0', outputPath
          ],
          progress
        )
      } else {
        const preset = PRESETS[String(options.quality) as keyof typeof PRESETS] ?? PRESETS.balanced
        await runFfmpeg(
          ['-y', '-i', inputPath, '-map', '0:v:0', '-map', '0:a:0?', ...(scale ? ['-vf', scale] : []), ...videoArgs(to, preset), outputPath],
          progress
        )
      }
      onProgress(1)
    }
  }
]
