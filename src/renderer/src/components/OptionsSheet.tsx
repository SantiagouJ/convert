import { useId, useState, type FormEvent } from 'react'
import type { OptionSpec, OptionValues, TargetOption } from '@shared/types'
import { categoryColor } from '../lib/categories'
import { changedValues, defaultValues, snapNumber } from '../lib/options'
import { Modal, Segmented, SwitchRow } from './controls'

interface OptionsSheetProps {
  target: TargetOption
  /** e.g. `3 PNG files` */
  sourceLabel: string
  onConvert: (values: OptionValues | undefined) => void
  onClose: () => void
}

type NumberSpec = Extract<OptionSpec, { type: 'number' }>

function NumberField({ spec, value, onChange }: { spec: NumberSpec; value: number; onChange: (value: number) => void }) {
  const id = useId()
  return (
    <div className="field">
      <label htmlFor={id}>{spec.label}</label>
      <div className="number">
        <input
          id={id}
          type="range"
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={value}
          onChange={(event) => onChange(snapNumber(spec, event.target.valueAsNumber))}
        />
        <input
          type="number"
          aria-label={`${spec.label}${spec.unit ? ` in ${spec.unit}` : ''}`}
          min={spec.min}
          max={spec.max}
          step={spec.step ?? 1}
          value={value}
          onChange={(event) => Number.isFinite(event.target.valueAsNumber) && onChange(event.target.valueAsNumber)}
          onBlur={() => onChange(snapNumber(spec, value))}
        />
        {spec.unit && <span className="unit">{spec.unit}</span>}
      </div>
    </div>
  )
}

export function OptionsSheet({ target, sourceLabel, onConvert, onClose }: OptionsSheetProps) {
  const selectId = useId()
  const [values, setValues] = useState<OptionValues>(() => defaultValues(target.options))
  const set = (key: string, value: string | number | boolean): void => setValues((current) => ({ ...current, [key]: value }))

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const clean: OptionValues = { ...values }
    for (const spec of target.options) {
      if (spec.type === 'number') clean[spec.key] = snapNumber(spec, Number(values[spec.key]))
    }
    onConvert(changedValues(target.options, clean))
  }

  const pristine = changedValues(target.options, values) === undefined

  return (
    <Modal label={`Options for ${target.format.label}`} className="sheet" onClose={onClose}>
      <form onSubmit={submit}>
        <header className="sheet-head">
          <span className="dot" style={{ background: categoryColor(target.format.category) }} />
          <div>
            <h2>To {target.format.label}</h2>
            <p>{sourceLabel}</p>
          </div>
        </header>

        <div className="sheet-body">
          {target.options.map((spec) => {
            if (spec.type === 'number') {
              return <NumberField key={spec.key} spec={spec} value={Number(values[spec.key])} onChange={(value) => set(spec.key, value)} />
            }
            if (spec.type === 'boolean') {
              return <SwitchRow key={spec.key} label={spec.label} checked={Boolean(values[spec.key])} onChange={(value) => set(spec.key, value)} />
            }
            const compact = spec.choices.length <= 4 && spec.choices.every((choice) => choice.label.length <= 9)
            return (
              <div className="field" key={spec.key}>
                {compact ? (
                  <>
                    <span className="field-label">{spec.label}</span>
                    <Segmented label={spec.label} value={String(values[spec.key])} choices={spec.choices} onChange={(value) => set(spec.key, value)} />
                  </>
                ) : (
                  <>
                    <label htmlFor={`${selectId}-${spec.key}`}>{spec.label}</label>
                    <select id={`${selectId}-${spec.key}`} value={String(values[spec.key])} onChange={(event) => set(spec.key, event.target.value)}>
                      {spec.choices.map((choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )
          })}
        </div>

        <footer className="sheet-foot">
          <button type="button" className="btn ghost" disabled={pristine} onClick={() => setValues(defaultValues(target.options))}>
            Reset
          </button>
          <span className="spacer" />
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn primary" data-autofocus>
            Convert
          </button>
        </footer>
      </form>
    </Modal>
  )
}
