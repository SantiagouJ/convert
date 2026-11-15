# Brief: data engine (spreadsheets and archives)

Read `CLAUDE.md` first. You are on branch `feat/data` in your own worktree. Start with `pnpm install`.

## Goal

Converters for spreadsheets and archives, fully offline.

## You own

- `src/main/converters/spreadsheet/**`, `src/main/converters/archive/**`
- `tests/data.test.ts` (plus helpers under `tests/data/`)
- dependency additions in `package.json`

## Scope

Spreadsheets:
- in: xlsx, xls, ods, csv, tsv, json (array of objects) — out: xlsx, ods, csv, tsv, json, html
- csv/tsv: detect delimiter and UTF-8 BOM on input; write UTF-8 with BOM so Excel opens accents correctly
- multi-sheet workbook -> csv/tsv/json: first sheet only (document this in the option label or add
  a `sheet` option)
- keep numbers as numbers and dates as ISO strings in json/csv

Archives:
- zip <-> tar <-> tar.gz, re-packed by streaming, preserving paths and modification times
- zip / tar / tar.gz / gz -> extracted folder is NOT a format conversion; skip it
- 7z and rar: input only, and only if a pure-JS or bundled-binary reader exists with a compatible
  license; otherwise leave them out and say so
- guard against path traversal entries (`../`) when reading archives

Choose libraries yourself; check current versions and their security advisories before adding one.

## Done when

- every declared pair has a test that builds a small source at test time, converts through the
  real `JobQueue`, and reads the output back to assert on its content
- `pnpm typecheck && pnpm test && pnpm build` pass; work is committed

Finish with a report: pairs supported, pairs you dropped and why, shared changes.
