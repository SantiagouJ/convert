import { readFile, writeFile } from 'node:fs/promises'
import type { Converter } from '@shared/types'

/**
 * Reference converter: small, dependency-free, and covers the whole contract.
 * Use it as the template for new domains.
 */

export interface Cue {
  /** Milliseconds. */
  start: number
  end: number
  text: string
}

const TIMING = /(\d+):(\d{2})(?::(\d{2}))?[.,](\d{1,3})\s*-->\s*(\d+):(\d{2})(?::(\d{2}))?[.,](\d{1,3})/

function toMs(a: string, b: string, c: string | undefined, fraction: string): number {
  // `mm:ss.mmm` (WebVTT short form) has no hours group.
  const [hours, minutes, seconds] = c === undefined ? [0, Number(a), Number(b)] : [Number(a), Number(b), Number(c)]
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction.padEnd(3, '0'))
}

/** Parses both SRT and WebVTT; they only differ in header and timestamp separator. */
export function parseCues(source: string): Cue[] {
  const blocks = source.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const at = lines.findIndex((line) => TIMING.test(line))
    if (at === -1) continue
    const m = TIMING.exec(lines[at])!
    const text = lines.slice(at + 1).join('\n').trim()
    if (!text) continue
    cues.push({ start: toMs(m[1], m[2], m[3], m[4]), end: toMs(m[5], m[6], m[7], m[8]), text })
  }
  return cues
}

function stamp(ms: number, separator: ',' | '.'): string {
  const pad = (value: number, size = 2) => String(value).padStart(size, '0')
  const hours = Math.floor(ms / 3_600_000)
  const minutes = Math.floor(ms / 60_000) % 60
  const seconds = Math.floor(ms / 1000) % 60
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}${separator}${pad(ms % 1000, 3)}`
}

export function toSrt(cues: Cue[]): string {
  return cues
    .map((cue, i) => `${i + 1}\n${stamp(cue.start, ',')} --> ${stamp(cue.end, ',')}\n${cue.text}\n`)
    .join('\n')
}

export function toVtt(cues: Cue[]): string {
  const body = cues.map((cue) => `${stamp(cue.start, '.')} --> ${stamp(cue.end, '.')}\n${cue.text}\n`)
  return ['WEBVTT\n', ...body].join('\n')
}

export function toPlainText(cues: Cue[]): string {
  return cues.map((cue) => cue.text.replace(/<[^>]+>/g, '')).join('\n') + '\n'
}

const WRITERS: Record<string, (cues: Cue[]) => string> = {
  srt: toSrt,
  vtt: toVtt,
  txt: toPlainText
}

export const converters: Converter[] = [
  {
    id: 'subtitle.text',
    category: 'subtitle',
    from: ['srt', 'vtt'],
    to: ['srt', 'vtt', 'txt'],
    async convert({ inputPath, outputPath, to, onProgress, signal }) {
      const cues = parseCues(await readFile(inputPath, 'utf8'))
      if (cues.length === 0) throw new Error('No subtitle cues found in this file')
      signal.throwIfAborted()
      onProgress(0.5)
      await writeFile(outputPath, WRITERS[to](cues), 'utf8')
      onProgress(1)
    }
  }
]
