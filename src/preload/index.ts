import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC, type ConvertApi, type Job, type Settings } from '@shared/types'

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T): void => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: ConvertApi = {
  pathForFile: (file) => webUtils.getPathForFile(file),
  getTargets: (paths) => ipcRenderer.invoke(IPC.getTargets, paths),
  startJobs: (request) => ipcRenderer.invoke(IPC.startJobs, request),
  cancelJob: (id) => ipcRenderer.invoke(IPC.cancelJob, id),
  listJobs: () => ipcRenderer.invoke(IPC.listJobs),
  onJobUpdate: (listener) => subscribe<Job>(IPC.jobUpdate, listener),
  onFilesOpened: (listener) => subscribe<string[]>(IPC.filesOpened, listener),
  pickFiles: () => ipcRenderer.invoke(IPC.pickFiles),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  reveal: (path) => ipcRenderer.invoke(IPC.reveal, path),
  getSettings: () => ipcRenderer.invoke(IPC.getSettings),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.updateSettings, patch),
  onSettingsChanged: (listener) => subscribe<Settings>(IPC.settingsChanged, listener)
}

contextBridge.exposeInMainWorld('convert', api)
