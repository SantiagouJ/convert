import type { ConvertApi } from '@shared/types'

let current: ConvertApi | null = null
let mocked = false

/**
 * Resolves the API the interface talks to: the real `window.convert`, or in
 * development the mock when the real one is absent (plain browser) or the page
 * was opened with `?mock`.
 */
export async function initApi(): Promise<void> {
  const wantsMock = new URLSearchParams(window.location.search).has('mock')
  if (import.meta.env.DEV && (!window.convert || wantsMock)) {
    const { createMockApi } = await import('./mock')
    current = createMockApi()
    mocked = true
    return
  }
  if (!window.convert) throw new Error('Convert could not start: the app bridge is missing.')
  current = window.convert
}

export function getApi(): ConvertApi {
  if (!current) throw new Error('API used before initApi()')
  return current
}

export const isMock = (): boolean => mocked
