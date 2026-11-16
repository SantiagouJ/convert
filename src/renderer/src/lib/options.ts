import type { OptionSpec, OptionValues } from '@shared/types'

export function defaultValues(specs: readonly OptionSpec[]): OptionValues {
  const values: OptionValues = {}
  for (const spec of specs) values[spec.key] = spec.default
  return values
}

/** Clamps a number option into its range and snaps it to its step. */
export function snapNumber(spec: Extract<OptionSpec, { type: 'number' }>, value: number): number {
  if (!Number.isFinite(value)) return spec.default
  const step = spec.step && spec.step > 0 ? spec.step : 1
  const snapped = spec.min + Math.round((value - spec.min) / step) * step
  const clamped = Math.min(spec.max, Math.max(spec.min, snapped))
  return Math.round(clamped * 1e6) / 1e6
}

/** Only the values that differ from the defaults; undefined when nothing was changed. */
export function changedValues(specs: readonly OptionSpec[], values: OptionValues): OptionValues | undefined {
  const changed: OptionValues = {}
  for (const spec of specs) {
    const value = values[spec.key]
    if (value !== undefined && value !== spec.default) changed[spec.key] = value
  }
  return Object.keys(changed).length > 0 ? changed : undefined
}
