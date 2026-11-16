import { useState, type KeyboardEvent } from 'react'
import type { Settings } from '@shared/types'
import { acceleratorCaps, acceleratorFromEvent } from '../lib/shortcut'
import { Modal, Segmented, SwitchRow } from './controls'
import { BackIcon, CloseIcon, FolderIcon } from './icons'

interface SettingsPanelProps {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  /** Opens the native folder picker. */
  pickFolder: () => Promise<string | null>
  onClose: () => void
}

function ShortcutRecorder({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const [recording, setRecording] = useState(false)
  const caps = acceleratorCaps(value)

  const onKeyDown = (event: KeyboardEvent): void => {
    if (!recording) return
    // Tab must keep working so the recorder never traps keyboard users.
    if (event.key === 'Tab') return
    event.preventDefault()
    event.stopPropagation()
    if (event.key === 'Escape') {
      setRecording(false)
      return
    }
    const bare = !event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey
    if (bare && (event.key === 'Backspace' || event.key === 'Delete')) {
      onChange('')
      setRecording(false)
      return
    }
    const accelerator = acceleratorFromEvent(event)
    if (accelerator) {
      onChange(accelerator)
      setRecording(false)
    }
  }

  return (
    <div className="row">
      <span className="row-text">
        <span id="shortcut-label">Show Convert from anywhere</span>
        <small>{recording ? 'Press the keys. Esc cancels, Backspace removes it.' : 'A keyboard shortcut that works in every app.'}</small>
      </span>
      <span className="recorder">
        <button
          type="button"
          className={`recorder-keys${recording ? ' is-recording' : ''}`}
          aria-labelledby="shortcut-label"
          aria-describedby="shortcut-value"
          onClick={() => setRecording((current) => !current)}
          onKeyDown={onKeyDown}
          onBlur={() => setRecording(false)}
        >
          <span id="shortcut-value">
            {recording ? (
              <em>Press keys…</em>
            ) : caps.length > 0 ? (
              caps.map((cap, index) => <kbd key={index}>{cap}</kbd>)
            ) : (
              <em>Not set</em>
            )}
          </span>
        </button>
        {value && !recording && (
          <button type="button" className="icon-btn" aria-label="Remove shortcut" title="Remove shortcut" onClick={() => onChange('')}>
            <CloseIcon />
          </button>
        )}
      </span>
    </div>
  )
}

export function SettingsPanel({ settings, onChange, pickFolder, onClose }: SettingsPanelProps) {
  const chooseFolder = async (): Promise<boolean> => {
    const folder = await pickFolder()
    if (!folder) return false
    onChange({ outputDir: folder, outputMode: 'folder' })
    return true
  }

  const setMode = (mode: Settings['outputMode']): void => {
    // "One folder" is meaningless without a folder, so ask for it right away.
    if (mode === 'folder' && !settings.outputDir) void chooseFolder()
    else onChange({ outputMode: mode })
  }

  return (
    <Modal label="Settings" className="settings" onClose={onClose}>
      <header className="settings-head">
        <button type="button" className="icon-btn" aria-label="Back" title="Back (Esc)" onClick={onClose} data-autofocus>
          <BackIcon />
        </button>
        <h2>Settings</h2>
      </header>

      <div className="settings-body">
        <section>
          <h3>Save converted files</h3>
          <Segmented
            label="Save converted files"
            value={settings.outputMode}
            choices={[
              { value: 'source', label: 'Next to the original' },
              { value: 'folder', label: 'In one folder' }
            ]}
            onChange={setMode}
          />
          {settings.outputMode === 'folder' && (
            <div className="row folder-row">
              <span className="row-text">
                <span className="path" title={settings.outputDir}>
                  {settings.outputDir || 'No folder chosen yet'}
                </span>
              </span>
              <button type="button" className="btn small" onClick={() => void chooseFolder()}>
                <FolderIcon /> Choose…
              </button>
            </div>
          )}
          <p className="note">Convert never replaces a file. If the name is taken, it adds a number.</p>
        </section>

        <section>
          <h3>When a batch finishes</h3>
          <SwitchRow label="Show the result in its folder" checked={settings.revealWhenDone} onChange={(value) => onChange({ revealWhenDone: value })} />
          <SwitchRow
            label="Send a notification"
            hint="Only when the window is in the background."
            checked={settings.notifyWhenDone}
            onChange={(value) => onChange({ notifyWhenDone: value })}
          />
        </section>

        <section>
          <h3>Window</h3>
          <SwitchRow label="Keep on top of other windows" checked={settings.alwaysOnTop} onChange={(value) => onChange({ alwaysOnTop: value })} />
          <SwitchRow
            label="Keep running when closed"
            hint="Closing hides the window in the tray."
            checked={settings.closeToTray}
            onChange={(value) => onChange({ closeToTray: value })}
          />
          <SwitchRow label="Start when I sign in" checked={settings.launchAtLogin} onChange={(value) => onChange({ launchAtLogin: value })} />
          <ShortcutRecorder value={settings.globalShortcut} onChange={(value) => onChange({ globalShortcut: value })} />
        </section>

        <section>
          <h3>Appearance</h3>
          <Segmented
            label="Appearance"
            value={settings.theme}
            choices={[
              { value: 'system', label: 'Match system' },
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' }
            ]}
            onChange={(theme) => onChange({ theme })}
          />
        </section>

        <p className="note center">Everything is converted on this computer. Nothing is uploaded.</p>
      </div>
    </Modal>
  )
}
