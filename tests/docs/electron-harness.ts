/**
 * Runs real conversions inside Electron's main process, through the real
 * JobQueue and registry. Bundled and launched by tests/docs.test.ts:
 *
 *   electron harness.cjs spec.json
 *
 * spec.json: { jobs: StartJobsRequest[], resultPath: string }
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { app } from 'electron'
import type { StartJobsRequest } from '@shared/types'
import { JobQueue } from '../../src/main/jobs'

const specPath = process.argv[process.argv.length - 1]
const spec = JSON.parse(readFileSync(specPath, 'utf8')) as { jobs: StartJobsRequest[]; resultPath: string }

// Hidden print windows come and go; never let that end the run early.
app.on('window-all-closed', () => {})

void app.whenReady().then(async () => {
  try {
    const queue = new JobQueue({ concurrency: 2 })
    for (const request of spec.jobs) queue.start(request)
    await queue.idle()
    writeFileSync(spec.resultPath, JSON.stringify({ electron: process.versions.electron, jobs: queue.list() }))
  } catch (error) {
    writeFileSync(spec.resultPath, JSON.stringify({ error: String(error) }))
  }
  app.exit(0)
})
