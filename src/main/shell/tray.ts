import { Menu, Tray, nativeImage } from 'electron'
import type { Settings } from '@shared/types'

export interface TrayActions {
  show: () => void
  convertFiles: () => void
  openOutputFolder: () => void
  setLaunchAtLogin: (value: boolean) => void
  setExplorerEntry: (value: boolean) => void
  quit: () => void
}

export class AppTray {
  private readonly tray: Tray
  private settings: Settings
  private explorerRegistered = false

  constructor(
    iconPath: string,
    settings: Settings,
    private readonly actions: TrayActions
  ) {
    this.settings = settings
    this.tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }))
    this.tray.setToolTip('Convert')
    this.tray.on('click', actions.show)
    this.refresh()
  }

  update(settings: Settings, explorerRegistered = this.explorerRegistered): void {
    this.settings = settings
    this.explorerRegistered = explorerRegistered
    this.refresh()
  }

  setProgressTooltip(text: string): void {
    this.tray.setToolTip(text)
  }

  destroy(): void {
    this.tray.destroy()
  }

  private refresh(): void {
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: 'Show', click: this.actions.show },
        { label: 'Convert files…', click: this.actions.convertFiles },
        { label: 'Open output folder', click: this.actions.openOutputFolder },
        { type: 'separator' },
        {
          label: 'Launch at login',
          type: 'checkbox',
          checked: this.settings.launchAtLogin,
          click: (item) => this.actions.setLaunchAtLogin(item.checked)
        },
        {
          label: 'Explorer right-click entry',
          type: 'checkbox',
          checked: this.explorerRegistered,
          click: (item) => this.actions.setExplorerEntry(item.checked)
        },
        { type: 'separator' },
        { label: 'Quit', click: this.actions.quit }
      ])
    )
  }
}
