# Brief: documents engine (PDF, Word, Markdown, HTML, text, EPUB, slides)

Read `CLAUDE.md` first. You are on branch `feat/docs` in your own worktree. Start with `pnpm install`.

## Goal

Document conversions that run fully offline with no external programs installed (no LibreOffice,
no pandoc on this machine). This is the hardest domain: fidelity is limited without an office
suite, so prefer fewer conversions that produce honest, readable output over many that produce garbage.

## You own

- `src/main/converters/document/**`, `src/main/converters/ebook/**`, `src/main/converters/slides/**`
- `tests/docs.test.ts` (plus helpers under `tests/docs/`)
- dependency additions in `package.json`

## Scope, in priority order

1. Text family through one shared intermediate (HTML or a small AST): md, html, txt, docx, rtf (in),
   odt (in) -> md, html, txt, docx. Preserve headings, emphasis, lists, links, tables, images where feasible.
2. Anything in the text family -> pdf. Electron is available: rendering HTML in a hidden
   `BrowserWindow` and calling `webContents.printToPDF` gives real typography for free. Keep the
   Electron-dependent part isolated so the rest stays unit-testable under plain Node/vitest.
3. pdf -> txt, md, html (text extraction with reading order), pdf -> png / jpg (one image per page
   at 300 DPI into a directory: use `outputKind: 'directory'`), pdf -> docx (text-flow, best effort).
4. epub <-> html / md / txt, and text family -> epub.
5. pptx -> pdf / png / jpg only if you find an approach that renders slides faithfully offline;
   otherwise ship pptx -> txt / md (slide text and notes) and say so in the report.

Choose libraries yourself; verify current versions and APIs against their docs rather than memory.
Rendering PDFs to images inside Electron's main process has pitfalls (canvas availability) —
decide deliberately and test it in the real runtime, not only in vitest.

## Done when

- every declared pair has a test that builds a small source at test time, converts through the
  real `JobQueue`, and asserts on the output's content (not just that a file exists)
- the Electron-only paths (print to PDF, page rasterization) were verified by actually running the
  built app or an Electron-run script, and you say how in the report
- `pnpm typecheck && pnpm test && pnpm build` pass; work is committed

Finish with a report: pairs supported with a one-line fidelity note each, pairs you dropped and
why, shared changes, packaging notes.
