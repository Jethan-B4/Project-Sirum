import React, { useMemo } from 'react';
import { Text } from 'react-native';
import { ChunkedChapter } from './ChunkedChapter';
import { ReaderCover } from './ReaderCover';
import { BASE_FONT_SIZE, readingFontFamily } from './ReadingStyleEditor';
import type { ReadingStyle } from '@/lib/settingsKeys';
import type { ChapterNavigation } from '@/formats/types';
import { linkColor } from '@/lib/color';
import { chunkChapter, plainParagraphs } from '@/text/chunk';
import { plainLinks, linksInRange } from '@/text/links';

export type LoadedChapter = { index: number; text: string; nav: ChapterNavigation | null };
type PassageProps = Pick<React.ComponentProps<typeof ChunkedChapter>, 'initialOffset' | 'onMove' | 'onToggleControls'
  | 'onScrollStart' | 'onPageTurn' | 'onChapterSwipe' | 'prepareChapter' | 'edgeTaps' | 'footer' | 'paged' | 'onLink'
  | 'safeTop' | 'safeBottom' | 'margin' | 'mediaDir' | 'startPadding' | 'endPadding'> & {
    page: LoadedChapter; style: ReadingStyle; viewportHeight: number; coverUri?: string | null;
    bookTitle: string; fallbackTitle?: string | null;
  };

export function BookPassage({ page, style, viewportHeight, coverUri, bookTitle, fallbackTitle, ...reader }: PassageProps) {
  const { text, index, nav } = page;
  const paragraphs = useMemo(() => nav?.paragraphs?.length ? nav.paragraphs :
    style.indentParagraphs ? plainParagraphs(text) : undefined, [nav, style.indentParagraphs, text]);
  const chunks = useMemo(() => chunkChapter(index, text, 0, nav?.images, paragraphs), [index, text, nav, paragraphs]);
  const links = useMemo(() => {
    const plain = plainLinks(text);
    if (!nav?.links.length) return plain;
    const extra = plain.filter(link => !linksInRange(nav.links, link.start, link.end).length);
    return extra.length ? [...nav.links, ...extra].sort((a, b) => a.start - b.start) : nav.links;
  }, [nav, text]);
  const embeddedCover = index === 0 && nav?.images?.length === 1 && !text.trim();
  const fontSize = BASE_FONT_SIZE * style.size / 100;
  const fontFamily = readingFontFamily(style.fam);
  return <ChunkedChapter {...reader} chunks={chunks} length={text.length} links={links} linkColor={linkColor(style.bg)}
    coverHeight={embeddedCover ? viewportHeight : undefined} paragraphs={paragraphs} publisherStyles={nav?.styles}
    indent={style.indentParagraphs ? style.indentLength : 0} textStyle={{ color: style.tx, fontFamily, fontSize,
      fontWeight: String(style.wt) as '400', lineHeight: Math.round(fontSize * style.lh), textAlign: style.align }}>
    {index === 0 && !embeddedCover && coverUri && <ReaderCover uri={coverUri} label={bookTitle + ' cover'} height={viewportHeight} />}
    {fallbackTitle && text !== fallbackTitle && !text.startsWith(fallbackTitle + '\n') &&
      <Text accessibilityRole="header" style={{ color: style.tx, fontFamily, fontWeight: '600',
        fontSize: fontSize * 1.3, marginBottom: 8, marginHorizontal: reader.margin }}>{fallbackTitle}</Text>}
  </ChunkedChapter>;
}
