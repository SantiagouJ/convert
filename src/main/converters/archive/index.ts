import { createWriteStream } from 'node:fs'
import type { Writable } from 'node:stream'
import { finished } from 'node:stream/promises'
import type { Converter } from '@shared/types'
import { readTar, readZip, tarSink, zipSink, type Sink, type Visit } from './streams'

/**
 * Archives that can be read and written by streaming. 7z and RAR are left out:
 * no pure-JS reader with a compatible license was adopted in this pass.
 */
const FORMATS = ['zip', 'tar', 'tar.gz']

async function readArchive(
  from: string,
  inputPath: string,
  visit: Visit,
  progress: (fraction: number) => void
): Promise<void> {
  if (from === 'zip') return readZip(inputPath, visit, progress)
  return readTar(inputPath, from === 'tar.gz', visit, progress)
}

function createSink(to: string, output: Writable, fail: (error: Error) => void): Sink {
  if (to === 'zip') return zipSink(output, fail)
  return tarSink(output, to === 'tar.gz', fail)
}

export const converters: Converter[] = [
  {
    id: 'archive.repack',
    category: 'archive',
    from: FORMATS,
    to: FORMATS,
    async convert({ inputPath, outputPath, from, to, onProgress, signal }) {
      const output = createWriteStream(outputPath)
      // Any write or sink failure rejects this promise, even while a reader is still busy.
      let fail!: (error: Error) => void
      const failed = new Promise<never>((_, reject) => (fail = reject))
      failed.catch(() => {})
      output.on('error', fail)
      try {
        const sink = createSink(to, output, fail)
        const reading = readArchive(
          from,
          inputPath,
          async (entry) => {
            signal.throwIfAborted()
            if (entry.directory) await sink.directory(entry)
            else await sink.file(entry, await entry.open())
          },
          (fraction) => onProgress(fraction * 0.95)
        )
        reading.catch(() => {})
        await Promise.race([reading, failed])
        await sink.close()
        onProgress(1)
      } catch (error) {
        // Close the file before the queue deletes it; a partial archive is never kept.
        output.destroy()
        await finished(output).catch(() => {})
        if (signal.aborted) throw error
        if (error instanceof Error && error.message.startsWith('This archive')) throw error
        throw new Error(`This ${from.toUpperCase()} archive could not be read. It may be damaged or encrypted.`)
      }
    }
  }
]
