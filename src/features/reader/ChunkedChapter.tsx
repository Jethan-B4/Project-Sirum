import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View, useWindowDimensions, type TextStyle, type NativeScrollEvent } from 'react-native';
import { Image } from 'expo-image';
import { ReaderCover } from './ReaderCover';
import { GestureDetector, ScrollView as GestureScrollView, usePanGesture } from 'react-native-gesture-handler';
import { linksInRange } from '@/text/links';
import type { BookLink, ChapterNavigation } from '@/formats/types';
import { type Chunk, findChunkForOffset, paragraphRows } from '@/text/chunk';

const WINDOW_SIZE = 7;
type Line = { offset: number; y: number };
type TextFrame = { top?: number; lines?: Line[] };
type Frame = TextFrame & { rows?: Map<number, TextFrame> };

function passageLine(frame: Frame, target: number, byOffset: boolean) {
  if (frame.top == null) return;
  let row: TextFrame = frame;
  let top = frame.top;
  if (frame.rows) {
    let best = -Infinity;
    for (const [offset, candidate] of frame.rows) {
      if (candidate.top == null) continue;
      const at = byOffset ? offset : frame.top + candidate.top;
      if (at <= target && at > best) { row = candidate; best = at; }
    }
    if (row === frame) return;
    top += row.top!;
  }
  const line = row.lines?.findLast((line) => (byOffset ? line.offset : top + line.y) <= target);
  if (line) return { offset: line.offset, y: top + line.y };
}

const LinkedText = React.memo(function LinkedText({ chunk, links, styles, textStyle, color, onLink }: {
  styles: ChapterNavigation['styles']; textStyle: TextStyle;
  chunk: Chunk; links: BookLink[]; color: string; onLink(href: string): void;
}) {
  const text = chunk.text.replace(/\n$/, '');
  const end = chunk.startOffset + text.length;
  const spans = styles ? linksInRange(styles, chunk.startOffset, end) : [];
  let spanIndex = 0;
  function styledText(from: number, to: number) {
    if (!spans.length) return text.slice(from, to);
    const nodes: React.ReactNode[] = [];
    while (spanIndex < spans.length && from < to) {
      const span = spans[spanIndex];
      const left = span.start - chunk.startOffset, right = span.end - chunk.startOffset;
      if (left >= to) break;
      if (from < left) nodes.push(text.slice(from, left));
      const start = Math.max(from, left);
      const stop = Math.min(to, right);
      const { bold, italic, underline, strike, scale, smallCaps } = span.style;
      const fontSize = textStyle.fontSize ?? 17;
      const style: TextStyle = {
        ...(bold && { fontWeight: 'bold' }),
        ...(italic && { fontStyle: 'italic' }),
        ...(smallCaps && { fontVariant: ['small-caps'] }),
        ...(underline || strike ? { textDecorationLine: underline && strike ? 'underline line-through' : underline ? 'underline' : 'line-through' } : {}),
        ...(scale && scale !== 1 ? { fontSize: fontSize * scale, lineHeight: Math.round((textStyle.lineHeight ?? fontSize) * scale) } : {}),
      };
      nodes.push(<Text key={start} style={style}>{text.slice(start, stop)}</Text>);
      from = stop;
      if (stop === right) spanIndex++;
    }
    if (from < to) nodes.push(text.slice(from, to));
    return nodes;
  }
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const link of linksInRange(links, chunk.startOffset, end)) {
    const from = Math.max(0, link.start - chunk.startOffset);
    const to = Math.min(end, link.end) - chunk.startOffset;
    if (cursor < from) parts.push(styledText(cursor, from));
    parts.push(<Text key={link.start} accessibilityRole="link" onPress={(event) => {
      event.stopPropagation();
      onLink(link.href);
    }}
      style={{ color, textDecorationLine: 'underline' }}>{styledText(from, to)}</Text>);
    cursor = to;
  }
  return <>{parts}{styledText(cursor, text.length)}</>;
});

function PassageText({ part, styles, links, textStyle, color, onLink, onLines, heading }: {
  part: Chunk; styles: ChapterNavigation['styles']; links: BookLink[]; textStyle: TextStyle;
  color: string; onLink(href: string): void; onLines(lines: Line[]): void;
  heading?: boolean;
}) {
  return (
    <Text
      accessibilityRole={heading ? 'header' : undefined}
      style={[textStyle, { flexShrink: 1, flexGrow: 1 }]}
      onTextLayout={(e) => {
        let cursor = 0;
        const lines = e.nativeEvent.lines.map((line) => {
          const match = part.text.indexOf(line.text, cursor);
          const local = match < 0 ? cursor : match;
          cursor = local + line.text.length;
          return { offset: part.startOffset + local, y: line.y };
        });
        onLines(lines);
      }}
    >
      <LinkedText chunk={part} links={links} styles={styles} textStyle={textStyle} color={color} onLink={onLink} />
    </Text>
  );
}

/** Keep a few native text blocks around the visible passage, in source order. */
export function ChunkedChapter({
  chunks,
  links,
  linkColor,
  onLink,
  length,
  initialOffset: requestedOffset,
  onMove,
  onToggleControls,
  onScrollStart,
  onChapterSwipe,
  paged = false,
  onPageTurn,
  margin,
  textStyle,
  publisherStyles,
  paragraphs,
  mediaDir,
  endPadding = 12,
  startPadding = 12,
  coverHeight,
  children,
  footer,
}: {
  chunks: Chunk[];
  links: BookLink[];
  linkColor: string;
  onLink(href: string): void;
  length: number;
  initialOffset: number | (() => number);
  onMove(offset: number): void;
  onToggleControls?: () => void;
  onScrollStart?: () => void;
  onChapterSwipe?: (direction: -1 | 1, atEnd?: boolean) => void;
  paged?: boolean;
  onPageTurn?: (direction: -1 | 1) => void;
  margin: number;
  textStyle: TextStyle;
  publisherStyles?: ChapterNavigation['styles'];
  paragraphs?: ChapterNavigation['paragraphs'];
  mediaDir?: string | null;
  startPadding?: number;
  endPadding?: number;
  /** Full viewport for the opening illustration of an image-only cover chapter. */
  coverHeight?: number;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  // Capture the entry passage once. Normal scroll feedback also updates the parent slider.
  const [initialOffset] = useState(requestedOffset);
  const target = initialOffset === 0 ? 0 : findChunkForOffset(chunks, initialOffset);
  const targetRow = useMemo(() => {
    const chunk = chunks[target];
    if (!initialOffset || !chunk?.text || !paragraphs?.length) return;
    return paragraphRows(chunk, paragraphs).findLast((row) => row.startOffset <= initialOffset)?.startOffset;
  }, [chunks, initialOffset, paragraphs, target]);
  const { height, width } = useWindowDimensions();
  const maxStart = Math.max(0, chunks.length - WINDOW_SIZE);
  const [start, setStart] = useState(() => Math.max(0, Math.min(maxStart, target - 3)));
  const end = Math.min(chunks.length, start + WINDOW_SIZE);
  const visibleRows = useMemo(() => paragraphs?.length
    ? chunks.slice(start, end).map((chunk) => paragraphRows(chunk, paragraphs)) : undefined, [chunks, paragraphs, start, end]);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const frames = useRef(new Map<number, Frame>());
  const dimensions = useRef({ viewport: 0, content: 0 });
  const seeking = useRef(initialOffset > 0);
  const moving = useRef(false);
  const lastY = useRef(0);
  const scrollY = useRef(0);
  const lastReported = useRef<number | undefined>(undefined);
  function turn(step: -1 | 1) {
    const { content, viewport } = dimensions.current;
    if (!paged) { onChapterSwipe?.(step); return; }
    if (coverHeight && !length) { onChapterSwipe?.(step, step < 0); return; }
    if (!viewport || !content) return;
    const stride = Math.max(1, viewport - Math.max(startPadding, 0) - endPadding - (textStyle.lineHeight ?? 24));
    const next = Math.max(0, Math.min(content - viewport, scrollY.current + step * stride));
    if (Math.abs(next - scrollY.current) <= 1) {
      if (step > 0 ? end === chunks.length : start === 0) onChapterSwipe?.(step, step < 0);
      return;
    }
    seeking.current = false;
    moving.current = true;
    onPageTurn?.(step);
    scroll.current?.scrollTo({ y: next, animated: false });
  }
  const pan = usePanGesture({
    enabled: !!onChapterSwipe || paged,
    activeOffsetX: [-20, 20],
    failOffsetY: [-12, 12],
    maxPointers: 1,
    runOnJS: true,
    onDeactivate: ({ canceled, translationX, translationY }) => {
      if (!canceled && Math.abs(translationX) >= 56 && Math.abs(translationX) > 2 * Math.abs(translationY)) {
        turn(translationX < 0 ? 1 : -1);
      }
    },
  });

  function restore() {
    if (!seeking.current) return;
    const frame = frames.current.get(target);
    const { content, viewport } = dimensions.current;
    if (!frame || !content || !viewport) return;
    if (targetRow !== undefined) {
      const row = frame.rows?.get(targetRow);
      if (row?.top == null || !row.lines?.length) return;
    }
    const line = passageLine(frame, initialOffset, true);
    if (!line) return;
    const y = line.y - startPadding;
    scroll.current?.scrollTo({ y: Math.max(0, Math.min(y, content - viewport)), animated: false });
    seeking.current = false;
  }

  function updateFrame(index: number, change: Frame) {
    frames.current.set(index, { ...frames.current.get(index), ...change });
    restore();
  }

  function updateRow(index: number, offset: number, change: TextFrame) {
    const frame = frames.current.get(index) ?? {};
    frame.rows ??= new Map();
    frame.rows.set(offset, { ...frame.rows.get(offset), ...change });
    frames.current.set(index, frame);
    restore();
  }

  function track(event: NativeScrollEvent) {
    scrollY.current = Math.max(0, event.contentOffset.y);
    if (!moving.current || seeking.current || !chunks.length) return;
    const y = Math.max(0, event.contentOffset.y);
    if (Math.abs(y - lastY.current) < 0.5) return;
    lastY.current = y;
    let visible = start;
    for (let i = start; i < end; i++) {
      const top = frames.current.get(i)?.top;
      if (top != null && top <= y + 1) visible = i;
    }
    const frame = frames.current.get(visible);
    if (!frame || frame.top == null) return;
    const line = passageLine(frame, y + 1, false);
    const atEnd =
      end === chunks.length &&
      y > 0 &&
      y + event.layoutMeasurement.height >= event.contentSize.height - 1;
    const offset = atEnd ? length : (line?.offset ?? chunks[visible].startOffset);
    if (lastReported.current !== offset) {
      lastReported.current = offset;
      onMove(offset);
    }
    // Keep the same native view visible while adding/removing siblings on either side.
    if ((visible <= start + 1 && start > 0) || (visible >= end - 2 && end < chunks.length)) {
      const next = Math.max(0, Math.min(maxStart, visible - 3));
      if (next !== start) {
        for (const index of frames.current.keys()) {
          if (index < next || index >= next + WINDOW_SIZE) frames.current.delete(index);
        }
        setStart(next);
      }
    }
  }

  const Scroller = onToggleControls ? GestureScrollView : ScrollView;
  const content = (
    <Scroller
      ref={scroll}
      {...((onChapterSwipe || paged) && { requireToFail: pan })}
      style={{ flex: 1 }}
      scrollEventThrottle={64}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      contentContainerStyle={{ paddingTop: start === 0 ? startPadding : 0, paddingBottom: end === chunks.length ? endPadding : 0 }}
      onLayout={(e) => {
        dimensions.current.viewport = e.nativeEvent.layout.height;
        restore();
      }}
      onContentSizeChange={(_, height) => {
        dimensions.current.content = height;
        restore();
      }}
      onScrollBeginDrag={(event) => {
        onScrollStart?.();
        lastY.current = Math.max(0, event.nativeEvent.contentOffset.y);
        seeking.current = false;
        moving.current = true;
      }}
      onScrollEndDrag={(e) => {
        track(e.nativeEvent);
        moving.current = false;
      }}
      onMomentumScrollBegin={() => {
        moving.current = true;
      }}
      onMomentumScrollEnd={(e) => {
        track(e.nativeEvent);
        moving.current = false;
      }}
      onScroll={(e) => track(e.nativeEvent)}
    >
      {start === 0 && children}
      {chunks.slice(start, end).map((chunk) => {
        const illustration = chunk.image;
        if (illustration && mediaDir) {
          const fullCover = chunk.chunkIndex === 0 && coverHeight;
          const picture = fullCover ? <ReaderCover uri={mediaDir + '/' + illustration.file} label={illustration.alt || 'Book cover'}
            height={fullCover} /> : <Image accessibilityLabel={illustration.alt || 'Illustration'} accessible
            source={{ uri: mediaDir + '/' + illustration.file }} contentFit="contain"
            style={{ width: '100%', height: Math.min(height * 0.75, (width - 2 * margin) / (illustration.aspect || 1.5)) }} />;
          return <View key={chunk.chunkIndex} style={{ marginHorizontal: fullCover ? 0 : margin, paddingVertical: fullCover ? 0 : 6 }}
            onLayout={(e) => updateFrame(chunk.chunkIndex, { top: e.nativeEvent.layout.y, lines: [{ offset: chunk.startOffset, y: 0 }] })}>
            {illustration.href ? <Pressable accessibilityRole="link" accessibilityLabel={illustration.alt || 'Linked illustration'}
              onPress={(e) => { e.stopPropagation(); onLink(illustration.href!); }}>{picture}</Pressable> : picture}
          </View>;
        }
        const font = textStyle.fontSize ?? 17;
        const lineHeight = textStyle.lineHeight ?? font;
        return (
          <View key={chunk.chunkIndex} collapsable={false} style={{ marginHorizontal: margin }}
            onLayout={(e) => updateFrame(chunk.chunkIndex, { top: e.nativeEvent.layout.y })}>
            {visibleRows ? visibleRows[chunk.chunkIndex - start].map((row) => {
              const block = row.paragraph;
              const depth = block?.indent ?? 0;
              const endsBlock = row.text.endsWith('\n') || row.startOffset + row.text.length === length;
              if (block?.hidden) return <View key={row.startOffset} collapsable={false}
                onLayout={(e) => updateRow(chunk.chunkIndex, row.startOffset, { top: e.nativeEvent.layout.y, lines: [{ offset: row.startOffset, y: 0 }] })} />;
              return (
                <View key={row.startOffset} style={{
                  flexDirection: 'row', alignItems: 'flex-start',
                  marginStart: Math.min(width * 0.25, Math.max(0, depth - 1) * font * 1.5),
                  marginTop: row.first ? block.gap * font + block.blankLines * lineHeight : 0,
                  width: block?.widthEm ? Math.min(width - 2 * margin, block.widthEm * font) : undefined,
                  maxWidth: block?.maxWidthPercent != null ? `${block.maxWidthPercent}%` : '100%',
                  alignSelf: block?.centerBlock && (block.widthEm || block.maxWidthPercent) ? 'center' : 'stretch',
                  borderBottomColor: textStyle.color, borderBottomWidth: endsBlock ? block?.ruleBelow : 0,
                  paddingBottom: endsBlock ? (block?.paddingBelow ?? 0) * font : 0,
                }} onLayout={(e) => updateRow(chunk.chunkIndex, row.startOffset, { top: e.nativeEvent.layout.y })}>
                  {depth > 0 && <Text style={[textStyle, { minWidth: font * 1.3, marginEnd: font * 0.3, textAlign: 'right' }]}>
                    {row.first ? block.marker : undefined}
                  </Text>}
                  <PassageText part={row} heading={block?.heading} styles={publisherStyles} links={links} textStyle={block?.align ? { ...textStyle, textAlign: block.align } : textStyle} color={linkColor} onLink={onLink}
                    onLines={(lines) => updateRow(chunk.chunkIndex, row.startOffset, { lines })} />
                </View>
              );
            }) : <PassageText part={chunk} styles={publisherStyles} links={links} textStyle={textStyle} color={linkColor} onLink={onLink}
              onLines={(lines) => updateFrame(chunk.chunkIndex, { lines })} />}
          </View>
        );
      })}
      {end === chunks.length && footer}
    </Scroller>
  );
  if (!onToggleControls) return content;
  return (
    <GestureDetector gesture={pan} touchAction="pan-y">
      <Pressable accessible={false} style={{ flex: 1 }} onPress={event => {
        const x = event.nativeEvent.pageX;
        if (paged && (x < width / 3 || x > width * 2 / 3)) turn(x < width / 3 ? -1 : 1);
        else onToggleControls();
      }}>
        {content}
      </Pressable>
    </GestureDetector>
  );
}
