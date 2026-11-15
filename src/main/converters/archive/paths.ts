/**
 * Turns an entry name from an archive into a safe relative path with forward
 * slashes. Returns `null` for entries that only name the root (`./`).
 * Throws for absolute paths, drive letters and any `..` segment: such an
 * archive is refused instead of writing outside the output.
 */
export function safeEntryName(raw: string): string | null {
  const name = raw.replace(/\\/g, '/')
  if (name.startsWith('/') || /^[A-Za-z]:/.test(name)) throw unsafePath(raw)

  const kept: string[] = []
  for (const part of name.split('/')) {
    if (part === '..') throw unsafePath(raw)
    if (part === '' || part === '.') continue
    kept.push(part)
  }
  return kept.length > 0 ? kept.join('/') : null
}

export function unsafePath(raw: string): Error {
  return new Error(`This archive has an unsafe file path ("${raw}"), so it was not converted`)
}
