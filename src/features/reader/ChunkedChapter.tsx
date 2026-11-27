import React, { useMemo, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextStyle, type NativeScrollEvent, type LayoutChangeEvent, type GestureResponderEvent } from 'react-native';
import { Image } from 'expo-image';
import { ReaderCover } from './ReaderCover';
import {
  GestureDetector,
  ScrollView as GestureScrollView,
  useSimultaneousGestures,
  useTapGesture,
} from 'react-native-gesture-handler';
import { useSwipeTurn, type Direction, type TurnDestination } from './useSwipeTurn';
import { linksInRange } from '@/text/links';
import type { BookLink, ChapterNavigation } from '@/formats/types';
import type { HeadingAlignment, HeadingUnderline } from '@/lib/settingsKeys';
import { type Chunk, findChunkForOffset, paragraphRows } from '@/text/chunk';
import type { HighlightRow } from '@/db/repositories/highlights';
import { decodeHighlightStyle } from './textSelection';
import type { SelectionAnchor } from './textSelection';
import { contrastText } from '@/lib/color';

const OVERSCAN = 3;
type Line = { offset: number; y: number; x?: number; width?: number; length?: number };
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

const LinkedText = React.memo(function LinkedText({ chunk, linkText, links, styles, highlights, textStyle, color, onLink, onSelectHighlight, underlineOverride }: {
  styles: ChapterNavigation['styles']; textStyle: TextStyle;
  chunk: Chunk; linkText: string; links: BookLink[];
  underlineOverride?: boolean;
  highlights?: Pick<HighlightRow, 'id' | 'start_offset' | 'end_offset' | 'color' | 'note'>[];
  color: string; onLink(href: string, label: string): void;
  onSelectHighlight?: (id: string, anchor: SelectionAnchor) => void;
}) {
  const text = chunk.text.replace(/\n$/, '');
  const end = chunk.startOffset + text.length;
  const spans = styles ? linksInRange(styles, chunk.startOffset, end) : [];
  function styledText(from: number, to: number) {
    const annotations = highlights?.filter(highlight =>
      highlight.start_offset < chunk.startOffset + to && highlight.end_offset > chunk.startOffset + from) ?? [];
    if (!spans.length && !annotations.length && underlineOverride !== true) return text.slice(from, to);
    const nodes: React.ReactNode[] = [];
    let cursor = from;
    while (cursor < to) {
      const absolute = chunk.startOffset + cursor;
      const span = spans.find(item => item.start <= absolute && item.end > absolute);
      const highlight = annotations.findLast(item => item.start_offset <= absolute && item.end_offset > absolute);
      const nextSpan = spans.find(item => item.start > absolute);
      const nextHighlight = annotations.find(item => item.start_offset > absolute);
      const stop = Math.min(to,
        span ? span.end - chunk.startOffset : nextSpan ? nextSpan.start - chunk.startOffset : to,
        highlight ? highlight.end_offset - chunk.startOffset : nextHighlight ? nextHighlight.start_offset - chunk.startOffset : to);
      if (stop <= cursor) break;
      const { bold, italic, underline, strike, scale, smallCaps } = span?.style ?? {};
      const fontSize = textStyle.fontSize ?? 17;
      const annotationStyle = highlight ? decodeHighlightStyle(highlight.color) : null;
      const decorationLine = [
        (underlineOverride ?? underline) || annotationStyle?.underline || highlight?.note ? 'underline' : '',
        strike ? 'line-through' : '',
      ].filter(Boolean).join(' ');
      const style: TextStyle = {
        ...(bold && { fontWeight: 'bold' }),
        ...(italic && { fontStyle: 'italic' }),
        ...(smallCaps && { fontVariant: ['small-caps'] }),
        ...(decorationLine && { textDecorationLine: decorationLine as TextStyle['textDecorationLine'] }),
        ...(highlight?.note && { textDecorationStyle: 'dotted' }),
        ...(scale && scale !== 1 ? { fontSize: fontSize * scale, lineHeight: Math.round((textStyle.lineHeight ?? fontSize) * scale) } : {}),
        ...(annotationStyle?.color && { backgroundColor: annotationStyle.color, color: contrastText(annotationStyle.color) }),
      };
      nodes.push(<Text key={`${cursor}-${stop}`} style={style}
        onPress={highlight && onSelectHighlight ? event => {
          event.stopPropagation();
          onSelectHighlight(highlight.id, { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
        } : undefined}>{text.slice(cursor, stop)}</Text>);
      cursor = stop;
    }
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
      onLink(link.href, linkText.slice(link.start, link.end));
    }}
      style={{ color, textDecorationLine: 'underline' }}>{styledText(from, to)}</Text>);
    cursor = to;
  }
  return <>{parts}{styledText(cursor, text.length)}</>;
});

function PassageText({ part, linkText, styles, links, highlights, textStyle, color, onLink, onLines, onSelectText, onSelectHighlight, heading, underlineOverride, indent = 0 }: {
  part: Chunk; linkText: string; styles: ChapterNavigation['styles']; links: BookLink[]; textStyle: TextStyle;
  highlights?: Pick<HighlightRow, 'id' | 'start_offset' | 'end_offset' | 'color' | 'note'>[];
  color: string; onLink(href: string, label: string): void; onLines(lines: Line[]): void;
  onSelectText?: (offset: number, anchor: SelectionAnchor) => void;
  onSelectHighlight?: (id: string, anchor: SelectionAnchor) => void;
  heading?: boolean;
  underlineOverride?: boolean;
  indent?: number;
}) {
  const linesRef = useRef<Line[]>([]);
  const prefix = '\u2003'.repeat(indent);
  const scale = styles ? linksInRange(styles, part.startOffset, part.startOffset + part.text.length)
    .reduce((largest, span) => Math.max(largest, span.style.scale ?? 1), 1) : 1;
  return (
    <Text
      accessibilityRole={heading ? 'header' : undefined}
      style={[textStyle, { flexGrow: 1, flexShrink: 1 }, scale > 1 && { lineHeight: Math.ceil((textStyle.lineHeight ?? 17) * scale) }]}
      selectable
      onLongPress={onSelectText ? (event: GestureResponderEvent) => {
        const { locationX, locationY } = event.nativeEvent;
        const line = linesRef.current.reduce<Line | undefined>((best, row) =>
          Math.abs(row.y - locationY) < Math.abs((best?.y ?? Infinity) - locationY) ? row : best, undefined);
        if (!line) return;
        const width = line.width ?? 1;
        const length = line.length ?? 1;
        const fraction = Math.max(0, Math.min(1, (locationX - (line.x ?? 0)) / Math.max(1, width)));
        onSelectText(line.offset + Math.min(Math.max(0, length - 1), Math.floor(fraction * length)),
          { x: event.nativeEvent.pageX, y: event.nativeEvent.pageY });
      } : undefined}
      onTextLayout={(e) => {
        let cursor = 0;
        const displayed = prefix + part.text;
        const lines = e.nativeEvent.lines.map((line) => {
          const match = displayed.indexOf(line.text, cursor);
          const local = match < 0 ? cursor : match;
          cursor = local + line.text.length;
          return { offset: part.startOffset + Math.max(0, local - prefix.length), y: line.y, x: line.x,
            width: line.width, length: Math.max(1, line.text.length - (local === 0 ? prefix.length : 0)) };
        });
        linesRef.current = lines;
        onLines(lines);
      }}
    >
      {prefix}<LinkedText chunk={part} linkText={linkText} links={links} styles={styles} highlights={highlights}
        textStyle={textStyle} color={color} onLink={onLink} onSelectHighlight={onSelectHighlight}
        underlineOverride={underlineOverride} />
    </Text>
  );
}

/** Keep a few native text blocks around the visible passage, in source order. */
type ChapterProps = {
  chunks: Chunk[];
  linkText: string;
  links: BookLink[];
  linkColor: string;
  onLink(href: string, label: string): void;
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
  highlights?: Pick<HighlightRow, 'id' | 'start_offset' | 'end_offset' | 'color' | 'note'>[];
  onSelectText?: (offset: number, anchor: SelectionAnchor) => void;
  onSelectHighlight?: (id: string, anchor: SelectionAnchor) => void;
  paragraphs?: ChapterNavigation['paragraphs'];
  mediaDir?: string | null;
  startPadding?: number;
  endPadding?: number;
  /** Full viewport for the opening illustration of an image-only cover chapter. */
  coverHeight?: number;
  children: React.ReactNode;
  footer: React.ReactNode;
  safeTop?: number;
  safeBottom?: number;
  edgeTaps?: boolean;
  indent?: number;
  headingAlign?: HeadingAlignment;
  headingUnderline?: HeadingUnderline;
  prepareChapter?: (step: Direction, atEnd: boolean) => Promise<TurnDestination | null>;
};

export function ChunkedChapter(props: ChapterProps) {
  const {
    chunks,
    linkText,
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
    onPageTurn, edgeTaps, indent = 0, prepareChapter, headingAlign = 'publisher',
    headingUnderline = 'publisher', safeTop = 0, safeBottom = 0,
    margin,
    textStyle,
    publisherStyles,
    highlights,
    onSelectText,
    onSelectHighlight,
    paragraphs,
    mediaDir,
    endPadding = 12,
    startPadding = 12,
    coverHeight,
    children,
    footer,
  } = props;
  // Capture the entry passage once. Normal scroll feedback also updates the parent slider.
  const [initialOffset] = useState(requestedOffset);
  const target = initialOffset === 0 ? 0 : findChunkForOffset(chunks, initialOffset);
  const targetRow = useMemo(() => {
    const chunk = chunks[target];
    if (!initialOffset || !chunk?.text || !paragraphs?.length) return;
    return paragraphRows(chunk, paragraphs).findLast((row) => row.startOffset <= initialOffset)?.startOffset;
  }, [chunks, initialOffset, paragraphs, target]);
  const { height, width } = useWindowDimensions();
  // Stable native slots keep the entire chapter scrollable during momentum. Only the
  // text near the viewport needs native paragraph and line measurements.
  const [range, setRange] = useState(() => ({
    start: Math.max(0, target - OVERSCAN), end: target + OVERSCAN + 1, heights: new Map<number, number>(),
  }));
  const virtual = chunks.length > 12;
  const start = virtual ? range.start : 0;
  const end = virtual ? Math.min(chunks.length, range.end) : chunks.length;
  const slots = useRef(new Map<number, { top: number; height: number }>());
  const estimates = useMemo(() => {
    if (!virtual) return [];
    const columns = Math.max(1, Math.floor((width - 2 * margin) / ((textStyle.fontSize ?? 17) * 0.52)));
    return chunks.map(chunk => chunk.image
      ? Math.min(height * 0.75, (width - 2 * margin) / (chunk.image.aspect || 1.5)) + 12
      : chunk.text.trimEnd().split('\n').reduce((n, line) => n + Math.max(1, Math.ceil(line.length / columns)), 0)
        * (textStyle.lineHeight ?? 24));
  }, [virtual, chunks, width, height, margin, textStyle.fontSize, textStyle.lineHeight]);
  const visibleRows = useMemo(() => paragraphs?.length
    ? chunks.slice(start, end).map((chunk) => paragraphRows(chunk, paragraphs)) : undefined, [chunks, paragraphs, start, end]);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const interactivePress = useRef(false);
  const frames = useRef(new Map<number, Frame>());
  const dimensions = useRef({ viewport: 0, content: 0 });
  const seeking = useRef(initialOffset > 0);
  const moving = useRef(false);
  const scrollY = useRef(0);
  const lastReported = useRef<number | undefined>(undefined);
  // A null destination crosses a chapter boundary; undefined means layout is not ready.
  function nextScrollY(step: Direction) {
    const { content, viewport } = dimensions.current;
    if (!paged || (coverHeight && !length)) return null;
    if (!viewport || !content) return undefined;
    const stride = Math.max(1, viewport - startPadding - endPadding - (textStyle.lineHeight ?? 24));
    const next = Math.max(0, Math.min(content - viewport, scrollY.current + step * stride));
    if (Math.abs(next - scrollY.current) > 1) return next;
    return null;
  }
  function scrollToPage(y: number) {
    seeking.current = false;
    moving.current = true;
    scroll.current?.scrollTo({ y, animated: false });
  }
  function turn(step: Direction) {
    const y = nextScrollY(step);
    if (y === null) onChapterSwipe?.(step, step < 0);
    else if (y !== undefined) { onPageTurn?.(step); scrollToPage(y); }
  }
  const swipe = useSwipeTurn(width, !!onChapterSwipe,
    step => prepareChapter?.(step, step < 0) ?? null,
    step => onChapterSwipe?.(step, step < 0), onScrollStart);
  const tap = useTapGesture({
    enabled: !!onToggleControls,
    runOnJS: true,
    cancelsTouchesInView: false,
    cancelsJSResponder: false,
    maxDuration: 250,
    maxDistance: 12,
    onActivate: event => {
      const x = event.x;
      requestAnimationFrame(() => {
        if (!onToggleControls || swipe.suppressTap() || interactivePress.current) {
          interactivePress.current = false;
          return;
        }
        swipe.cancel();
        if (edgeTaps && (x < width / 3 || x > width * 2 / 3)) turn(x < width / 3 ? -1 : 1);
        else onToggleControls();
      });
    },
  });
  const readerGestures = useSimultaneousGestures(swipe.pan, tap);

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
    const y = initialOffset === length ? content - viewport : line.y - startPadding;
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

  function markInteractiveTap() {
    interactivePress.current = true;
    requestAnimationFrame(() => requestAnimationFrame(() => { interactivePress.current = false; }));
  }
  function handleLink(href: string, label: string) {
    markInteractiveTap();
    onLink(href, label);
  }
  function handleSelectHighlight(id: string, anchor: SelectionAnchor) {
    markInteractiveTap();
    onSelectHighlight?.(id, anchor);
  }

  function slotAt(y: number) {
    let lo = 0, hi = chunks.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if ((slots.current.get(mid)?.top ?? Infinity) <= y) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
  function track(event: NativeScrollEvent) {
    const y = scrollY.current = Math.max(0, event.contentOffset.y);
    if (seeking.current || !chunks.length || !slots.current.size) return;
    const visible = slotAt(y + 1);
    const bottom = slotAt(y + event.layoutMeasurement.height);
    if (virtual && ((visible <= start + 1 && start > 0) || (bottom >= end - 2 && end < chunks.length))) {
      const next = { start: Math.max(0, visible - OVERSCAN), end: Math.min(chunks.length, bottom + OVERSCAN + 1) };
      if (next.start !== start || next.end !== end) {
        const heights = new Map(range.heights);
        for (let i = start; i < end; i++) {
          const slot = slots.current.get(i);
          if (slot) heights.set(i, slot.height);
        }
        setRange({ ...next, heights });
      }
    }
    if (!moving.current) return;
    const frame = frames.current.get(visible);
    const line = frame && passageLine(frame, y + 1, false);
    const atEnd = y > 0 && y + event.layoutMeasurement.height >= event.contentSize.height - 1;
    const offset = atEnd ? length : (line?.offset ?? chunks[visible].startOffset);
    if (lastReported.current !== offset) {
      lastReported.current = offset;
      onMove(offset);
    }
  }

  const Scroller = onToggleControls ? GestureScrollView : ScrollView;
  const content = (
    <Scroller
      ref={scroll}
      {...(onChapterSwipe && { requireToFail: swipe.pan })}
      style={{ flex: 1, marginTop: safeTop, marginBottom: safeBottom }}
      scrollEventThrottle={16}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      contentContainerStyle={{ paddingTop: startPadding, paddingBottom: endPadding }}
      onLayout={(e) => {
        dimensions.current.viewport = e.nativeEvent.layout.height;
        restore();
      }}
      onContentSizeChange={(_, height) => {
        dimensions.current.content = height;
        restore();
      }}
      onScrollBeginDrag={() => {
        swipe.cancel();
        onScrollStart?.();
        seeking.current = false;
        moving.current = true;
      }}
      onScrollEndDrag={(e) => {
        track(e.nativeEvent);
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
      {children}
      {chunks.map((chunk, index) => {
        const mounted = index >= start && index < end;
        const onLayout = (event: LayoutChangeEvent) => {
          const { y: top, height: slotHeight } = event.nativeEvent.layout;
          slots.current.set(index, { top, height: slotHeight });
          if (mounted) updateFrame(index, { top });
          else frames.current.delete(index);
        };
        if (!mounted) return <View key={index} collapsable={false} onLayout={onLayout}
          style={{ height: range.heights.get(index) ?? estimates[index] }} />;
        const illustration = chunk.image;
        if (illustration && mediaDir) {
          const fullCover = chunk.chunkIndex === 0 && coverHeight;
          const picture = fullCover ? <ReaderCover uri={mediaDir + '/' + illustration.file} label={illustration.alt || 'Book cover'}
            height={fullCover} /> : <Image accessibilityLabel={illustration.alt || 'Illustration'} accessible
            source={{ uri: mediaDir + '/' + illustration.file }} contentFit="contain"
            style={{ width: '100%', height: Math.min(height * 0.75, (width - 2 * margin) / (illustration.aspect || 1.5)) }} />;
          return <View key={chunk.chunkIndex} style={{ marginHorizontal: fullCover ? 0 : margin, paddingVertical: fullCover ? 0 : 6 }}
            onLayout={(e) => { onLayout(e); updateFrame(index, { lines: [{ offset: chunk.startOffset, y: 0 }] }); }}>
            {illustration.href ? <Pressable accessibilityRole="link" accessibilityLabel={illustration.alt || 'Linked illustration'}
              onPress={(e) => { e.stopPropagation(); handleLink(illustration.href!, illustration.alt || 'Linked illustration'); }}>{picture}</Pressable> : picture}
          </View>;
        }
        const font = textStyle.fontSize ?? 17;
        const lineHeight = textStyle.lineHeight ?? font;
        return (
          <View key={chunk.chunkIndex} collapsable={false} style={{ marginHorizontal: margin }}
            onLayout={onLayout}>
            {visibleRows ? visibleRows[chunk.chunkIndex - start].map((row) => {
              const block = row.paragraph;
              const align = block?.heading && headingAlign !== 'publisher' ? headingAlign : block?.align;
              const underlineOverride = block?.heading && headingUnderline !== 'publisher'
                ? headingUnderline === 'on' : undefined;
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
                  <PassageText part={row} linkText={linkText} indent={row.first && !block?.heading && !block?.marker && align !== 'center' && align !== 'right' && row.text.trim() ? indent : 0} heading={block?.heading} underlineOverride={underlineOverride} styles={publisherStyles} links={links} highlights={highlights} textStyle={align ? { ...textStyle, textAlign: align } : textStyle} color={linkColor} onLink={handleLink} onSelectText={onSelectText} onSelectHighlight={handleSelectHighlight}
                    onLines={(lines) => updateRow(chunk.chunkIndex, row.startOffset, { lines })} />
                </View>
              );
            }) : <PassageText part={chunk} linkText={linkText} styles={publisherStyles} links={links} highlights={highlights} textStyle={textStyle} color={linkColor} onLink={handleLink} onSelectText={onSelectText} onSelectHighlight={handleSelectHighlight}
              onLines={(lines) => updateFrame(chunk.chunkIndex, { lines })} />}
          </View>
        );
      })}
      {footer}
    </Scroller>
  );
  if (!onToggleControls) return content;
  return (
    <GestureDetector gesture={readerGestures} touchAction="pan-y">
      <View accessible={false} style={{ flex: 1, overflow: 'hidden' }}>
        <Animated.View style={[{ flex: 1 }, swipe.activeStyle]}>{content}</Animated.View>
        {swipe.preview && <Animated.View key={swipe.preview.step} pointerEvents="none" accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants" style={[StyleSheet.absoluteFill, swipe.previewStyle]}>
          {swipe.preview.view}
        </Animated.View>}
      </View>
    </GestureDetector>
  );
}
