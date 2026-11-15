import type { Converter, OptionSpec } from '@shared/types'
import { probeDuration, runFfmpeg } from '../../lib/ffmpeg'

const AUDIO = ['mp3', 'm4a', 'wav', 'flac', 'ogg', 'opus', 'aiff', 'wma']
const LOSSY = ['mp3', 'm4a', 'ogg', 'opus', 'wma']

/** Encoder arguments per target (container forced where the extension is ambiguous). */
export function audioEncodeArgs(to: string, bitrateKbps: number): string[] {
  const rate = ['-b:a', `${bitrateKbps}k`]
  switch (to) {
    case 'mp3':
      return ['-c:a', 'libmp3lame', ...rate]
    case 'm4a':
      return ['-c:a', 'aac', ...rate, '-f', 'ipod']
    case 'ogg':
      return ['-c:a', 'libvorbis', ...rate]
    case 'opus':
      return ['-c:a', 'libopus', ...rate, '-f', 'opus']
    case 'wma':
      return ['-c:a', 'wmav2', ...rate, '-f', 'asf']
    case 'flac':
      return ['-c:a', 'flac']
    case 'aiff':
      return ['-c:a', 'pcm_s16be', '-f', 'aiff']
    default:
      return ['-c:a', 'pcm_s16le']
  }
}

export function bitrateOption(to: string): OptionSpec[] {
  if (!LOSSY.includes(to)) return []
  return [
    {
      key: 'bitrate',
      label: 'Bitrate',
      type: 'select',
      default: '192',
      choices: ['96', '128', '192', '256', '320'].map((value) => ({ value, label: `${value} kbps` }))
    }
  ]
}

export const converters: Converter[] = [
  {
    id: 'audio.ffmpeg',
    category: 'audio',
    from: AUDIO,
    to: AUDIO,
    options: bitrateOption,
    async convert({ inputPath, outputPath, to, options, signal, onProgress }) {
      const durationSec = await probeDuration(inputPath, signal)
      await runFfmpeg(
        ['-y', '-i', inputPath, '-vn', '-map_metadata', '0', ...audioEncodeArgs(to, Number(options.bitrate ?? 192)), outputPath],
        { signal, durationSec, onProgress }
      )
      onProgress(1)
    }
  }
]
