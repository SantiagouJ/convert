# Convert

Offline drag-and-drop file converter for the desktop (Windows first). Drop files, pick a target
format from a radial wheel, get the result next to the original. Nothing is ever uploaded.

Stack: Electron + electron-vite, React 19, TypeScript (strict), vitest, pnpm.

## Commands

- `pnpm install` — if `node_modules/electron/dist` is missing afterwards, run `node node_modules/electron/install.js`
- `pnpm dev` — run the app with HMR
- `pnpm typecheck`, `pnpm test`, `pnpm build` — all three must pass before every commit

## Architecture

- `src/shared/formats.ts` — catalog of every known extension (label, category) and `normalizeExt` / `extOf`.
- `src/shared/types.ts` — the contracts: `Converter`, `ConvertContext`, `Job`, `Settings`, and
  `ConvertApi` (what the renderer sees as `window.convert`).
- `src/main/registry.ts` — auto-loads `src/main/converters/*/index.ts` (each exports
  `converters: Converter[]`). There is no central list to edit.
- `src/main/jobs.ts` — `JobQueue`: picks collision-free output paths (never overwrites), runs
  jobs with limited concurrency, deletes partial output on failure or cancel.
- `src/main/index.ts` — window, IPC handlers, single-instance and "open with" handling.
- `src/preload/index.ts` — implements `ConvertApi` over IPC. Renderer is sandboxed, no Node access.
- `src/renderer/` — React UI.
- `src/main/converters/subtitle/` — reference converter; copy its shape.

## Rules for converters

- Extensions are lowercase, no dot, normalized (`jpg` not `jpeg`). Every extension used must exist
  in `src/shared/formats.ts`; `tests/core.test.ts` enforces this.
- Write only to `ctx.outputPath`. Never touch the input. Do not clean up on failure: throw, the queue cleans up.
- Honor `ctx.signal` (kill child processes) and report `ctx.onProgress` for anything slow.
- Throw `Error`s with a short message a non-technical user can understand.
- Everything runs locally and offline. No network calls, no telemetry.
- Native binaries (ffmpeg, sharp) must also resolve inside a packaged app, where
  `app.asar` paths have to be rewritten to `app.asar.unpacked`.
- Each domain ships tests in `tests/<domain>.test.ts` that run real conversions on small fixtures
  generated at test time (do not commit binary fixtures larger than a few KB).

## Working in parallel worktrees

Several agents work at once, each on its own branch and worktree. To keep merges clean, stay
inside the files your brief in `.claude/briefs/` assigns to you. If you need a change in a shared
file (`src/shared/*`, `src/main/registry.ts`, `src/main/jobs.ts`, another agent's folder), keep it
minimal and additive, and list it under "Shared changes" in your final report. Commit small and
often on your branch; never push, never merge, never switch branches.
