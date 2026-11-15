import type { ConvertApi } from '@shared/types'

declare global {
  interface Window {
    convert: ConvertApi
  }
}

export {}
