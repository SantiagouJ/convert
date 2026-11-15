/**
 * Format catalog shared by main and renderer.
 *
 * Every extension a converter reads or writes must be listed here so the UI
 * can label and group it. Extensions are always lowercase, without the dot,
 * and already normalized through `normalizeExt`.
 */

export type Category =
  | 'image'
  | 'video'
  | 'audio'
  | 'document'
  | 'spreadsheet'
  | 'slides'
  | 'subtitle'
  | 'archive'
  | 'ebook'

export interface FormatInfo {
  ext: string
  label: string
  category: Category
}

const ALIASES: Record<string, string> = {
  jpeg: 'jpg',
  jpe: 'jpg',
  tif: 'tiff',
  htm: 'html',
  markdown: 'md',
  text: 'txt',
  aif: 'aiff',
  m4v: 'mp4',
  oga: 'ogg',
  tgz: 'tar.gz'
}

const COMPOUND_EXTS = ['tar.gz']

const f = (ext: string, label: string, category: Category): FormatInfo => ({ ext, label, category })

export const FORMATS: readonly FormatInfo[] = [
  f('jpg', 'JPG', 'image'),
  f('png', 'PNG', 'image'),
  f('webp', 'WebP', 'image'),
  f('heic', 'HEIC', 'image'),
  f('tiff', 'TIFF', 'image'),
  f('avif', 'AVIF', 'image'),
  f('bmp', 'BMP', 'image'),
  f('gif', 'GIF', 'image'),
  f('ico', 'ICO', 'image'),
  f('svg', 'SVG', 'image'),

  f('mp4', 'MP4', 'video'),
  f('mov', 'MOV', 'video'),
  f('mkv', 'MKV', 'video'),
  f('webm', 'WebM', 'video'),
  f('avi', 'AVI', 'video'),
  f('wmv', 'WMV', 'video'),

  f('mp3', 'MP3', 'audio'),
  f('m4a', 'M4A', 'audio'),
  f('wav', 'WAV', 'audio'),
  f('flac', 'FLAC', 'audio'),
  f('ogg', 'OGG', 'audio'),
  f('opus', 'Opus', 'audio'),
  f('aiff', 'AIFF', 'audio'),
  f('wma', 'WMA', 'audio'),

  f('pdf', 'PDF', 'document'),
  f('docx', 'Word', 'document'),
  f('md', 'Markdown', 'document'),
  f('txt', 'Text', 'document'),
  f('html', 'HTML', 'document'),
  f('rtf', 'RTF', 'document'),
  f('odt', 'ODT', 'document'),

  f('epub', 'EPUB', 'ebook'),

  f('pptx', 'PowerPoint', 'slides'),
  f('ppt', 'PowerPoint 97', 'slides'),

  f('xlsx', 'Excel', 'spreadsheet'),
  f('xls', 'Excel 97', 'spreadsheet'),
  f('ods', 'ODS', 'spreadsheet'),
  f('csv', 'CSV', 'spreadsheet'),
  f('tsv', 'TSV', 'spreadsheet'),
  f('json', 'JSON', 'spreadsheet'),

  f('srt', 'SRT', 'subtitle'),
  f('vtt', 'WebVTT', 'subtitle'),

  f('zip', 'ZIP', 'archive'),
  f('tar', 'TAR', 'archive'),
  f('tar.gz', 'TAR.GZ', 'archive'),
  f('gz', 'GZIP', 'archive'),
  f('7z', '7-Zip', 'archive'),
  f('rar', 'RAR', 'archive')
]

const BY_EXT = new Map(FORMATS.map((info) => [info.ext, info]))

/** Lowercases, strips a leading dot and resolves aliases (`JPEG` -> `jpg`). */
export function normalizeExt(ext: string): string {
  const clean = ext.trim().toLowerCase().replace(/^\./, '')
  return ALIASES[clean] ?? clean
}

/** Extension of a file name or path, normalized. Empty string when there is none. */
export function extOf(fileName: string): string {
  const base = fileName.replace(/^.*[\\/]/, '').toLowerCase()
  for (const compound of COMPOUND_EXTS) {
    if (base.endsWith(`.${compound}`) && base.length > compound.length + 1) return compound
  }
  const dot = base.lastIndexOf('.')
  if (dot <= 0) return ''
  return normalizeExt(base.slice(dot + 1))
}

export function formatInfo(ext: string): FormatInfo | undefined {
  return BY_EXT.get(normalizeExt(ext))
}
