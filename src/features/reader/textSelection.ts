export type HighlightStyle = { color: string | null; underline: boolean };
export type SelectionAnchor = { x: number; y: number };

export function characterRangeAt(text: string, offset: number): { start: number; end: number } | null {
  const points = Array.from(text);
  let cursor = 0;
  for (const point of points) {
    const end = cursor + point.length;
    if (offset < end) return { start: cursor, end };
    cursor = end;
  }
  return null;
}

export function wordRangeAt(text: string, offset: number): { start: number; end: number } | null {
  const isWord = (value: string) => /[\p{L}\p{M}\p{N}_]/u.test(value);
  const points = Array.from(text);
  const starts: number[] = [];
  let cursor = 0;
  for (const point of points) {
    starts.push(cursor);
    cursor += point.length;
  }
  const at = Math.max(0, Math.min(text.length, offset));
  let index = starts.findIndex((start, i) => at < start + points[i].length);
  if (index < 0) index = points.length;
  if (index >= points.length || !isWord(points[index])) return null;
  let endIndex = index + 1;
  while (index > 0 && isWord(points[index - 1])) index--;
  while (endIndex < points.length && isWord(points[endIndex])) endIndex++;
  return { start: starts[index], end: starts[endIndex] ?? text.length };
}

export function encodeHighlightStyle({ color, underline }: HighlightStyle): string | null {
  if (!color) return null;
  return underline ? `u:${color}` : color;
}

export function decodeHighlightStyle(value: string | null): HighlightStyle {
  if (value?.startsWith('u:')) return { color: value.slice(2) || null, underline: true };
  return { color: value, underline: false };
}
