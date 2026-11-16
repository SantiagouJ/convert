import type { ConvertApi } from '@shared/types'

declare global {
  interface Window {
    /** Injected by the preload script. Absent when the renderer runs in a plain browser. */
    convert?: ConvertApi
  }
}

export {}
