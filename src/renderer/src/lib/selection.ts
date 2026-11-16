import { extOf, formatInfo, type Category } from '@shared/formats'

export function fileName(path: string): string {
  return path.replace(/^.*[\\/]/, '')
}

export interface SelectionGroup {
  /** Normalized extension, empty when the file has none. */
  ext: string
  label: string
  category: Category | null
  count: number
}

export interface SelectionSummary {
  count: number
  names: string[]
  /** One entry per distinct extension, most frequent first. */
  groups: SelectionGroup[]
  mixed: boolean
  /** Short text for the wheel hub: `SRT`, `3 PNG`, `4 mixed`. */
  badge: string
  /** Sentence for the selection strip: `3 PNG files`, `4 files · PNG, Word`. */
  headline: string
}

export function summarizeSelection(paths: readonly string[]): SelectionSummary {
  const names = paths.map(fileName)
  const byExt = new Map<string, SelectionGroup>()
  for (const name of names) {
    const ext = extOf(name)
    const info = formatInfo(ext)
    const group = byExt.get(ext)
    if (group) group.count++
    else
      byExt.set(ext, {
        ext,
        label: info?.label ?? (ext ? ext.toUpperCase() : 'Unknown'),
        category: info?.category ?? null,
        count: 1
      })
  }
  const groups = [...byExt.values()].sort((a, b) => b.count - a.count)
  const count = names.length
  const mixed = groups.length > 1
  const files = count === 1 ? 'file' : 'files'

  let badge = ''
  let headline = ''
  if (count > 0 && !mixed) {
    badge = count === 1 ? groups[0].label : `${count} ${groups[0].label}`
    headline = `${count} ${groups[0].label} ${files}`
  } else if (mixed) {
    badge = `${count} mixed`
    const shown = groups.slice(0, 3).map((group) => group.label)
    const rest = groups.length - shown.length
    headline = `${count} files · ${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}`
  }
  return { count, names, groups, mixed, badge, headline }
}
