import { extOf, formatInfo, normalizeExt } from '@shared/formats'
import type { Converter, OptionSpec, OptionValues, TargetOption } from '@shared/types'

type ConverterModule = { converters?: Converter[] }

// Each domain folder contributes its converters; no central list to edit.
const modules = import.meta.glob<ConverterModule>('./converters/*/index.ts', { eager: true })

const converters: Converter[] = Object.values(modules)
  .flatMap((mod) => mod.converters ?? [])
  .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0))

export function allConverters(): readonly Converter[] {
  return converters
}

function handles(converter: Converter, from: string, to: string): boolean {
  if (from === to) return false
  if (!converter.from.includes(from) || !converter.to.includes(to)) return false
  return converter.supports ? converter.supports(from, to) : true
}

export function findConverter(from: string, to: string): Converter | undefined {
  const source = normalizeExt(from)
  const target = normalizeExt(to)
  return converters.find((converter) => handles(converter, source, target))
}

/** Target extensions available for one source extension, in catalog order of discovery. */
export function targetsForExt(from: string): string[] {
  const source = normalizeExt(from)
  const targets = new Set<string>()
  for (const converter of converters) {
    if (!converter.from.includes(source)) continue
    for (const to of converter.to) {
      if (handles(converter, source, to)) targets.add(to)
    }
  }
  return [...targets]
}

/** Targets that every given file can be converted to. */
export function targetsForFiles(paths: string[]): TargetOption[] {
  const exts = [...new Set(paths.map(extOf))]
  if (exts.length === 0 || exts.includes('')) return []

  const [first, ...rest] = exts.map(targetsForExt)
  const common = first.filter((to) => rest.every((list) => list.includes(to)))

  return common.flatMap((to) => {
    const format = formatInfo(to)
    if (!format) return []
    // With mixed inputs only the options every converter shares are safe to offer.
    const specLists = exts.map((from) => findConverter(from, to)?.options?.(to) ?? [])
    const options = specLists[0].filter((spec) =>
      specLists.every((list) => list.some((other) => other.key === spec.key))
    )
    return [{ format, options }]
  })
}

/** Fills missing option values with the converter's defaults. */
export function resolveOptions(specs: OptionSpec[], values: OptionValues = {}): OptionValues {
  const resolved: OptionValues = {}
  for (const spec of specs) {
    const value = values[spec.key]
    resolved[spec.key] = value === undefined ? spec.default : value
  }
  return resolved
}
