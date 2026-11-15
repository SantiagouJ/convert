# Brief: interface (drop surface, radial wheel, queue, settings)

Read `CLAUDE.md` first. You are on branch `feat/ui` in your own worktree. Start with `pnpm install`.

## Goal

Replace the placeholder renderer with the real interface. The product idea: converting a file
should take one gesture. The user drops files on a small window, a radial wheel of target formats
blooms around the drop point, they release or click a slice, and the conversion runs. The window
is compact (default 460x620) and may be always-on-top, so it must look good small.

This is an original product. It is inspired by the *interaction idea* of a radial format wheel,
but its name, visual identity, layout and artwork must be its own — do not reproduce any existing
app's look.

## You own

- `src/renderer/**` (everything; `App.tsx` and `styles.css` are throwaway placeholders)
- `tests/ui/**` for pure logic (wheel geometry, state reducers)
- dependency additions in `package.json` (keep it light; no heavy UI kit)

Talk to the app only through `window.convert` (`ConvertApi` in `src/shared/types.ts`). Do not edit
`src/main/**` or `src/preload/**`. If the API lacks something, add the minimal type to
`src/shared/types.ts`, stub it defensively in the renderer, and list it in your report.

## Scope

1. Drop surface: idle state invites a drop or click-to-browse; drag-over state reacts; handles
   files handed in by the OS (`onFilesOpened`). Shows what is selected (count, names, mixed types).
2. Radial wheel: targets from `getTargets`, grouped/colored by `format.category`. Works with a
   mouse (hover slice, click), with drag (wheel appears while dragging over the window, drop on a
   slice converts immediately), and with the keyboard (arrows move, Enter applies, Escape
   cancels, typing a letter jumps). Must scale from 2 targets to 20+ (overflow ring or "more"
   slice). Empty state when no conversion exists for the selection.
3. Options: when the chosen target has `options` (quality, bitrate…), offer them without adding a
   mandatory step — defaults convert in one gesture, a modifier or secondary affordance opens the
   options sheet. Render all three `OptionSpec` types.
4. Queue: live jobs with progress, cancel, error message, reveal result; batch summary; clear finished.
5. Settings panel for every field of `Settings`, including a shortcut recorder and folder picker.
6. Theme: dark and light, following `settings.theme`; respects reduced motion; fully usable by keyboard.

Until the other branches land, only subtitle conversions exist. Build against a dev-only mock of
`window.convert` (many formats, slow fake progress, failures) that activates when the real API is
absent or a query flag is set, so the UI can be developed in a plain browser and is ready for the
full catalog.

## Done when

- you ran `pnpm dev`, exercised every state above in the real app, and looked at the result
  (screenshots if you have a way to take them) at the default and at the minimum window size
- `pnpm typecheck && pnpm test && pnpm build` pass; work is committed

Finish with a report: what you verified visually and how, known rough edges, shared changes.
