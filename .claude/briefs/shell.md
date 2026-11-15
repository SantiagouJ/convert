# Brief: desktop shell (tray, shortcuts, Explorer integration, packaging)

Read `CLAUDE.md` first. You are on branch `feat/shell` in your own worktree. Start with `pnpm install`.

## Goal

Make Convert behave like a native Windows utility that is always one gesture away, and make it installable.

## You own

- `src/main/index.ts`, `src/main/shell/**`, `src/main/settings.ts`
- packaging: `electron-builder` config, `build/**` (icons, installer assets), npm scripts
- `tests/shell.test.ts` for the logic that can run without Electron
- dependency additions in `package.json`

Do not edit `src/renderer/**` (another agent is rebuilding it) or the converters.

## Scope

1. Tray icon with menu: Show, Convert files… (file picker -> sends paths to the window via the
   existing `filesOpened` channel), Open output folder, Launch at login (checkbox), Quit.
   Closing the window hides to tray when `settings.closeToTray`.
2. Apply every field of `Settings` (see `src/shared/types.ts`) at startup and on change:
   `alwaysOnTop`, `globalShortcut` (toggle window visibility; re-register on change, report
   conflicts without crashing), `launchAtLogin`, `closeToTray`, `notifyWhenDone` (one notification
   per finished batch while the window is unfocused; clicking it reveals the output),
   `revealWhenDone`.
3. Windows Explorer integration without admin rights (per-user registry under HKCU or the
   "Send to" folder): right-click one or many files -> "Convert with Convert" opens the app with
   those files selected. Multi-selection must arrive as a single batch (the single-instance
   handler already receives argv; debounce multiple launches). Register on first run, provide a
   way to unregister, and make the installer's uninstall clean it up.
4. Taskbar progress bar (`setProgressBar`) reflecting the overall queue.
5. Packaging with electron-builder: NSIS per-user installer and a portable build, app icon
   (generate a simple original icon; orange fruit-slice idea is fine, do not copy any existing
   app's artwork), `asarUnpack` for native binaries (`ffmpeg-static`, `ffprobe-static`, `sharp`,
   `@img/*`) — other branches add those dependencies, so write the globs now.
   `pnpm dist` must produce an installer in `release/`.

Keep `src/main/index.ts` thin: put each concern in its own module under `src/main/shell/`.

## Done when

- `pnpm dist` builds an installer; you ran the unpacked app and verified tray, shortcut,
  close-to-tray, "open with" from a second launch, and the Explorer entry
- `pnpm typecheck && pnpm test && pnpm build` pass; work is committed

Finish with a report: what was verified by actually running it and how, what could not be
verified, shared changes.
