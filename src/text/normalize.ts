export const NORMALIZATION_VERSION = 1;

/**
 * Normalize a raw text string:
 * - Normalize Unicode to NFC
 * - Strip BOM (U+FEFF) at any position
 * - Normalize all line endings to \n
 * - Remove control characters except \n and \t
 * - Strip leading/trailing \n from the result
 */
export function normalizeText(raw: string): string {
  // Normalize Unicode to NFC
  let text = raw.normalize('NFC');

  // Strip BOM (U+FEFF) at any position
  text = text.replace(/\uFEFF/g, '');

  // Normalize all line endings to \n (handles \r\n and bare \r)
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // Remove control characters except \n (U+000A) and \t (U+0009)
  // Control chars are U+0000–U+001F and U+007F–U+009F
  // eslint-disable-next-line no-control-regex
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

  // Strip leading/trailing \n from the result
  text = text.replace(/^\n+/, '').replace(/\n+$/, '');

  return text;
}
