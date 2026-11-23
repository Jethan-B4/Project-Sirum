export interface BookLink {
  start: number;
  end: number;
  href: string;
}

export interface ChapterNavigation {
  packageDir?: string;
  links: BookLink[];
  anchors: [string, number][];
  presentationVersion?: 1 | 2;
  paragraphs?: ChapterParagraph[];
  styles?: { start: number; end: number; style: PublisherStyle }[];
  images?: ChapterImage[];
}

/** Layout at a canonical character offset. List labels and spacing occupy no characters. */
export interface ChapterParagraph {
  offset: number;
  gap: number; // space above, in reader font units
  blankLines: number;
  indent: number; // list and quotation nesting depth
  marker?: string;
}

export function presentationFile(index: number) {
  return String(index).padStart(4, '0') + '.presentation-v2.json';
}

export interface PublisherStyle {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  scale?: number;
}

export interface ChapterImage {
  offset: number;
  file: string;
  alt: string;
  href?: string;
  aspect?: number;
}

export interface Chapter {
  index: number;        // 0-based position in spine order
  title: string;        // TOC label, first heading, or "Section N"
  navigation?: ChapterNavigation;
  sourceHref?: string;  // EPUB spine item path / PDF outline target
  startOffset: number;  // global UTF-16 code unit offset into concatenated book text
  charCount: number;
  text: string;         // the normalized chapter text (not stored in SQLite — written to disk)
}

export interface ImportedBook {
  format: 'epub' | 'txt' | 'pdf';
  title: string;
  author?: string;
  contentHash: string;    // SHA-256 hex
  sizeBytes: number;
  encoding?: string;      // TXT only
  normalizationVersion: number;
  charCount: number;      // sum of all chapter char counts
  coverData?: Uint8Array; // raw image bytes, saved to cover.jpg locally
  chapters: Chapter[];
}
