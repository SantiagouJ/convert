import { strToU8, zipSync } from 'fflate'
import { Document, ExternalHyperlink, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import { PDFDocument, StandardFonts } from 'pdf-lib'

/**
 * Small documents built at test time. Every fixture carries the same
 * content so assertions can be shared: a "Report Title" heading, a
 * paragraph with bold "important" text, a list with "alpha" / "beta",
 * a table with "Cell A1" / "Cell B1" and a link to example.com.
 */

/** 1x1 red PNG. */
export const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
  'base64'
)

export const MARKDOWN = `# Report Title

Intro with **important** words and a [link](https://example.com).

- alpha
- beta

| Name | Value |
| --- | --- |
| Cell A1 | Cell B1 |

## Second Section

Closing paragraph.
`

export const HTML = `<!DOCTYPE html><html><head><title>Report Title</title><script>alert(1)</script></head><body>
<h1>Report Title</h1>
<p>Intro with <strong>important</strong> words and a <a href="https://example.com">link</a>.</p>
<ul><li>alpha</li><li>beta</li></ul>
<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Cell A1</td><td>Cell B1</td></tr></tbody></table>
<h2>Second Section</h2>
<p>Closing paragraph.</p>
</body></html>`

export const TEXT = `Report Title

Intro with important words and a link.

alpha
beta

Cell A1 Cell B1

Second Section

Closing paragraph.
`

export const RTF = String.raw`{\rtf1\ansi\ansicpg1252\deff0{\fonttbl{\f0 Calibri;}}{\colortbl;\red0\green0\blue0;}
{\*\generator Test;}
\pard\outlinelevel0\b Report Title\b0\par
\pard Intro with {\b important} words and a {\field{\*\fldinst HYPERLINK "https://example.com"}{\fldrslt link}}. Caf\'e9 EURO\par
{\pntext\bullet\tab}alpha\par
{\pntext\bullet\tab}beta\par
\pard\intbl Cell A1\cell Cell B1\cell\row
\pard\outlinelevel1 Second Section\par
\pard Closing paragraph.\par
}`.replace('EURO', '\\u8364?')

export async function makeDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('Report Title')] }),
          new Paragraph({
            children: [
              new TextRun('Intro with '),
              new TextRun({ text: 'important', bold: true }),
              new TextRun(' words and a '),
              new ExternalHyperlink({ link: 'https://example.com', children: [new TextRun('link')] }),
              new TextRun('.')
            ]
          }),
          new Paragraph({ text: 'alpha', bullet: { level: 0 } }),
          new Paragraph({ text: 'beta', bullet: { level: 0 } }),
          new Table({
            rows: [
              new TableRow({
                children: [new TableCell({ children: [new Paragraph('Cell A1')] }), new TableCell({ children: [new Paragraph('Cell B1')] })]
              })
            ]
          }),
          new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun('Second Section')] }),
          new Paragraph('Closing paragraph.')
        ]
      }
    ]
  })
  return Packer.toBuffer(doc)
}

export function makeOdt(): Uint8Array {
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" office:version="1.3">
<office:automatic-styles>
  <style:style style:name="T1" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>
  <text:list-style style:name="L1"><text:list-level-style-bullet text:level="1" text:bullet-char="•"/></text:list-style>
</office:automatic-styles>
<office:body><office:text>
  <text:h text:outline-level="1">Report Title</text:h>
  <text:p>Intro with <text:span text:style-name="T1">important</text:span> words and a <text:a xlink:href="https://example.com">link</text:a>.<draw:frame><draw:image xlink:href="Pictures/dot.png"/></draw:frame></text:p>
  <text:list text:style-name="L1"><text:list-item><text:p>alpha</text:p></text:list-item><text:list-item><text:p>beta</text:p></text:list-item></text:list>
  <table:table><table:table-row><table:table-cell><text:p>Cell A1</text:p></table:table-cell><table:table-cell><text:p>Cell B1</text:p></table:table-cell></table:table-row></table:table>
  <text:h text:outline-level="2">Second Section</text:h>
  <text:p>Closing<text:s/>paragraph.</text:p>
</office:text></office:body></office:document-content>`
  return zipSync({
    mimetype: [strToU8('application/vnd.oasis.opendocument.text'), { level: 0 }],
    'content.xml': strToU8(content),
    'Pictures/dot.png': PNG_1PX
  })
}

export async function makePdf(): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  const regular = await pdf.embedFont(StandardFonts.Helvetica)
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold)
  const page = pdf.addPage([595, 842])
  page.drawText('Report Title', { x: 50, y: 760, size: 24, font: bold })
  page.drawText('Intro with important words and a link.', { x: 50, y: 720, size: 11, font: regular })
  page.drawText('This line continues the same paragraph.', { x: 50, y: 706, size: 11, font: regular })
  page.drawText('Second Section', { x: 50, y: 660, size: 16, font: bold })
  page.drawText('Closing paragraph.', { x: 50, y: 630, size: 11, font: regular })
  const second = pdf.addPage([595, 842])
  second.drawText('Page two text.', { x: 50, y: 760, size: 11, font: regular })
  return pdf.save()
}

export function makeEpub(): Uint8Array {
  const chapter = (title: string, body: string) => `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head><body>${body}</body></html>`
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/book.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OPS/book.opf': strToU8(`<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="2.0" unique-identifier="id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:identifier id="id">x</dc:identifier></metadata>
<manifest>
<item id="c1" href="text/one.xhtml" media-type="application/xhtml+xml"/>
<item id="c2" href="text/two.xhtml" media-type="application/xhtml+xml"/>
<item id="img" href="images/dot.png" media-type="image/png"/>
</manifest>
<spine><itemref idref="c1"/><itemref idref="c2"/></spine>
</package>`),
    'OPS/text/one.xhtml': strToU8(
      chapter('Report Title', '<h1>Report Title</h1><p>Intro with <b>important</b> words and a <a href="https://example.com">link</a>.</p><ul><li>alpha</li><li>beta</li></ul><p><img src="../images/dot.png" alt="dot"/></p>')
    ),
    'OPS/text/two.xhtml': strToU8(
      chapter('Second', '<h1>Second Section</h1><table><tr><td>Cell A1</td><td>Cell B1</td></tr></table><p>Closing paragraph.</p>')
    ),
    'OPS/images/dot.png': PNG_1PX
  })
}

export function makePptx(): Uint8Array {
  const ns = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"'
  const rel = (id: string, type: string, target: string) =>
    `<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/>`
  const rels = (items: string) =>
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`
  const shape = (ph: string, paras: string[]) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="1" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody>${paras.join('')}</p:txBody></p:sp>`
  const para = (text: string, lvl = 0) => `<a:p><a:pPr lvl="${lvl}"/><a:r><a:t>${text}</a:t></a:r></a:p>`
  const slide = (title: string, body: string[]) =>
    `<?xml version="1.0"?><p:sld ${ns}><p:cSld><p:spTree>${shape('title', [para(title)])}${shape('', body)}</p:spTree></p:cSld></p:sld>`
  return zipSync({
    '[Content_Types].xml': strToU8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'),
    'ppt/presentation.xml': strToU8(
      // Presentation order deliberately differs from file numbering.
      `<?xml version="1.0"?><p:presentation ${ns}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`
    ),
    'ppt/_rels/presentation.xml.rels': strToU8(rels(rel('rId2', 'slide', 'slides/slide1.xml') + rel('rId3', 'slide', 'slides/slide2.xml'))),
    'ppt/slides/slide2.xml': strToU8(slide('Opening Slide', [para('First point'), para('Sub point', 1)])),
    'ppt/slides/_rels/slide2.xml.rels': strToU8(rels(rel('rId1', 'notesSlide', '../notesSlides/notesSlide1.xml'))),
    'ppt/notesSlides/notesSlide1.xml': strToU8(
      `<?xml version="1.0"?><p:notes ${ns}><p:cSld><p:spTree>${shape('body', [para('Remember to smile')])}</p:spTree></p:cSld></p:notes>`
    ),
    'ppt/slides/slide1.xml': strToU8(slide('Closing Slide', [para('Thanks &amp; questions')]))
  })
}
