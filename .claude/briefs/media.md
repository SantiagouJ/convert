# Brief: media engine (images, audio, video)

Read `CLAUDE.md` first. You are on branch `feat/media` in your own worktree. Start with `pnpm install`.

## Goal

Converters for images, audio and video, fully offline.

## You own

- `src/main/converters/image/**`, `src/main/converters/audio/**`, `src/main/converters/video/**`
- `src/main/lib/ffmpeg.ts` (binary resolution, spawn, progress parsing, cancellation)
- `tests/media.test.ts` (plus helpers under `tests/media/`)
- dependency additions in `package.json`

## Scope

Images (suggested: `sharp`):
- in: jpg, png, webp, heic, tiff, avif, bmp, gif, svg, ico — out: jpg, png, webp, avif, tiff, bmp, gif, ico
- options: quality for lossy targets; flatten transparency onto white for jpg/bmp
- verify what the installed sharp build really decodes/encodes (heic, bmp, ico are the risky ones) and
  only declare pairs that work; fall back to ffmpeg or a small pure-JS encoder where that is simple

Audio (ffmpeg via `ffmpeg-static`):
- mp3, m4a, wav, flac, ogg, opus, aiff, wma in every direction the bundled ffmpeg supports
- option: bitrate for lossy targets

Video (ffmpeg):
- in/out: mp4, mov, mkv, webm, avi, wmv; plus video -> gif (palette-based, good quality) and
  video -> mp3/m4a/wav (audio extraction, category stays `video`)
- options: quality preset (CRF-based) and optional max height
- progress from `-progress pipe:1` against the probed duration; cancellation kills the process

## Done when

- every declared pair is exercised by a test that generates a tiny source (ffmpeg `lavfi` /
  sharp `create`), converts through the real `JobQueue`, and asserts the output decodes
- cancelling a running video job leaves no output file and no orphan ffmpeg process
- `pnpm typecheck && pnpm test && pnpm build` pass; work is committed

Finish with a report: pairs supported, pairs you dropped and why, shared changes, anything the
packaging step must know (binaries to unpack from asar).
