export interface Chapter {
  index: number;        // 0-based position in spine order
  title: string;        // TOC label, first heading, or "Section N"
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
