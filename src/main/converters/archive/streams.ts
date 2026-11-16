import { createReadStream, statSync } from 'node:fs'
import type { Readable, Writable } from 'node:stream'
import { finished as finishedAsync } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import * as tar from 'tar-stream'
import yauzl from 'yauzl'
import yazl from 'yazl'
import { safeEntryName, unsafePath } from './paths'

/** One regular file or folder read from an archive, or about to be written to one. */
export interface Entry {
  /** Safe relative path, forward slashes, no trailing slash. */
  name: string
  directory: boolean
  size: number
  mtime: Date
  /** Unix permission bits when the archive has them. */
  mode?: number
  /** Opens the content of a file entry. The visitor must read it to the end. */
  open: () => Promise<Readable>
}

export type Visit = (entry: Entry) => Promise<void>

const SYMLINK = 0o120000
const TYPE_MASK = 0o170000
const DIRECTORY_MODE = 0o755
const FILE_MODE = 0o644

/** Walks a zip file one entry at a time. Symlinks are skipped: they cannot be stored portably. */
export function readZip(path: string, visit: Visit, progress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (openError, zip) => {
      if (openError || !zip) return reject(openError ?? new Error('not a zip file'))
      const total = Math.max(zip.entryCount, 1)
      let seen = 0

      const fail = (error: Error) => {
        zip.close()
        reject(error)
      }
      // yauzl refuses unsafe names itself while reading; report them like safeEntryName does.
      const translate = (error: Error): Error => {
        const match = /^(?:invalid relative path|absolute path|invalid characters in fileName): (.*)$/s.exec(error.message)
        return match ? unsafePath(match[1]) : error
      }

      zip.on('entry', (entry: yauzl.Entry) => {
        void (async () => {
          seen++
          progress(seen / total)
          const attributes = entry.externalFileAttributes
          const unixBits = attributes >>> 16
          const unixType = unixBits & TYPE_MASK
          const mode = unixBits !== 0 ? unixBits & 0o7777 : undefined
          const name = safeEntryName(entry.fileName)
          if (unixType !== SYMLINK && name !== null) {
            await visit({
              name,
              directory: entry.fileName.endsWith('/'),
              size: entry.uncompressedSize,
              mtime: entry.getLastModDate(),
              mode,
              open: () =>
                new Promise<Readable>((res, rej) =>
                  zip.openReadStream(entry, (error, stream) => (error || !stream ? rej(error) : res(stream)))
                )
            })
          }
          zip.readEntry()
        })().catch(fail)
      })
      zip.on('end', () => resolve())
      zip.on('error', (error: Error) => fail(translate(error)))
      zip.readEntry()
    })
  })
}

/** Walks a tar (optionally gzipped) stream, one entry at a time, without extracting to disk. */
export function readTar(
  path: string,
  gzipped: boolean,
  visit: Visit,
  progress: (fraction: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const extract = tar.extract()
    const raw = createReadStream(path)
    const total = Math.max(fileSize(path), 1)
    let read = 0
    raw.on('data', (chunk: Buffer) => {
      read += chunk.length
      progress(Math.min(1, read / total))
    })
    const input: Readable = gzipped ? raw.pipe(createGunzip()) : raw

    extract.on('entry', (header, stream, next) => {
      // tar-stream types its entry body as its own `Source`; at runtime it is a plain Readable.
      const body = stream as unknown as Readable
      void (async () => {
        try {
          const name = header.type === 'file' || header.type === 'directory' ? safeEntryName(header.name) : null
          if (name !== null) {
            await visit({
              name,
              directory: header.type === 'directory',
              size: header.size ?? 0,
              mtime: header.mtime ?? new Date(0),
              mode: header.mode !== undefined ? header.mode & 0o7777 : undefined,
              open: async () => body
            })
          }
          // Skipped entries (symlinks, devices) still have to be read past.
          body.resume()
          await finishedAsync(body)
          next()
        } catch (error) {
          body.resume()
          extract.destroy()
          raw.destroy()
          reject(error)
        }
      })()
    })
    extract.on('finish', () => resolve())
    extract.on('error', reject)
    input.on('error', reject)
    input.pipe(extract)
  })
}

function fileSize(path: string): number {
  try {
    return statSync(path).size
  } catch {
    return 0
  }
}

export interface Sink {
  directory: (entry: Entry) => Promise<void>
  file: (entry: Entry, content: Readable) => Promise<void>
  /** Writes the end of the archive and resolves once the output is flushed. */
  close: () => Promise<void>
}

/** Writes entries into a zip. Streams: content is compressed as it arrives. */
export function zipSink(output: Writable, fail: (error: Error) => void): Sink {
  const zip = new yazl.ZipFile()
  zip.on('error', fail)
  zip.outputStream.on('error', fail)
  zip.outputStream.pipe(output)
  return {
    async directory(entry) {
      zip.addEmptyDirectory(entry.name, { mtime: entry.mtime, mode: entry.mode ?? DIRECTORY_MODE })
    },
    async file(entry, content) {
      zip.addReadStream(content, entry.name, { mtime: entry.mtime, mode: entry.mode ?? FILE_MODE })
      await finishedAsync(content)
    },
    async close() {
      zip.end()
      await finishedAsync(output)
    }
  }
}

/** Writes entries into a tar, gzipped when `gzipped` is set. */
export function tarSink(output: Writable, gzipped: boolean, fail: (error: Error) => void): Sink {
  const pack = tar.pack()
  pack.on('error', fail)
  if (gzipped) {
    const gzip = createGzip()
    gzip.on('error', fail)
    gzip.pipe(output)
    pack.pipe(gzip)
  } else {
    pack.pipe(output)
  }
  return {
    directory(entry) {
      return new Promise((resolve, reject) => {
        pack.entry(
          { name: `${entry.name}/`, type: 'directory', mtime: entry.mtime, mode: entry.mode ?? DIRECTORY_MODE },
          (error) => (error ? reject(error) : resolve())
        )
      })
    },
    file(entry, content) {
      return new Promise((resolve, reject) => {
        const target = pack.entry(
          { name: entry.name, type: 'file', size: entry.size, mtime: entry.mtime, mode: entry.mode ?? FILE_MODE },
          (error) => (error ? reject(error) : resolve())
        )
        content.on('error', reject)
        content.pipe(target)
      })
    },
    async close() {
      pack.finalize()
      await finishedAsync(output)
    }
  }
}
