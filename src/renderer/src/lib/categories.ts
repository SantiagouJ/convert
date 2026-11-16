import type { Category } from '@shared/formats'

export const CATEGORY_LABEL: Record<Category, string> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  document: 'Document',
  spreadsheet: 'Data',
  slides: 'Slides',
  subtitle: 'Subtitles',
  archive: 'Archive',
  ebook: 'E-book'
}

/** CSS custom property holding the colour of a category. */
export const categoryColor = (category: Category | null): string =>
  category ? `var(--cat-${category})` : 'var(--muted)'
