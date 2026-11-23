import React, { useRef, useState } from 'react';
import { ScrollView, Text, type TextStyle, type NativeScrollEvent } from 'react-native';
import { linksInRange } from '@/text/links';
import type { BookLink } from '@/formats/types';
import { type Chunk, findChunkForOffset } from '@/text/chunk';

const WINDOW_SIZE = 7;
type Line = { offset: number; y: number };
type Frame = { top?: number; lines?: Line[] };

const LinkedText = React.memo(function LinkedText({ chunk, links, color, onLink }: {
  chunk: Chunk; links: BookLink[]; color: string; onLink(href: string): void;
}) {
  const text = chunk.text.replace(/\n$/, '');
  const end = chunk.startOffset + text.length;
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  for (const link of linksInRange(links, chunk.startOffset, end)) {
    const from = Math.max(0, link.start - chunk.startOffset);
    const to = Math.min(end, link.end) - chunk.startOffset;
    if (cursor < from) parts.push(text.slice(cursor, from));
    parts.push(<Text key={link.start} accessibilityRole="link" onPress={() => onLink(link.href)}
      style={{ color, textDecorationLine: 'underline' }}>{text.slice(from, to)}</Text>);
    cursor = to;
  }
  return <>{parts}{text.slice(cursor)}</>;
});

/** Keep a few native text blocks around the visible passage, in source order. */
export function ChunkedChapter({
  chunks,
  links,
  linkColor,
  onLink,
  length,
  initialOffset: requestedOffset,
  onMove,
  margin,
  textStyle,
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
  margin: number;
  textStyle: TextStyle;
  children: React.ReactNode;
  footer: React.ReactNode;
}) {
  // Capture the entry passage once. Normal scroll feedback also updates the parent slider.
  const [initialOffset] = useState(requestedOffset);
  const target = findChunkForOffset(chunks, initialOffset);
  const maxStart = Math.max(0, chunks.length - WINDOW_SIZE);
  const [start, setStart] = useState(() => Math.max(0, Math.min(maxStart, target - 3)));
  const end = Math.min(chunks.length, start + WINDOW_SIZE);
  const scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const frames = useRef(new Map<number, Frame>());
  const dimensions = useRef({ viewport: 0, content: 0 });
  const seeking = useRef(initialOffset > 0);
  const moving = useRef(false);
  const lastY = useRef(0);

  function restore() {
    if (!seeking.current) return;
    const frame = frames.current.get(target);
    const { content, viewport } = dimensions.current;
    if (!frame?.lines?.length || frame.top == null || !content || !viewport) return;
    const line = frame.lines.findLast((item) => item.offset <= initialOffset);
    const y = frame.top + (line?.y ?? 0);
    scroll.current?.scrollTo({ y: Math.max(0, Math.min(y, content - viewport)), animated: false });
    seeking.current = false;
  }

  function updateFrame(index: number, change: Frame) {
    frames.current.set(index, { ...frames.current.get(index), ...change });
    restore();
  }

  function track(event: NativeScrollEvent) {
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
    if (!frame?.lines?.length || frame.top == null) return;
    const line = frame.lines.findLast((item) => item.y <= y - frame.top! + 1);
    const atEnd =
      end === chunks.length &&
      y > 0 &&
      y + event.layoutMeasurement.height >= event.contentSize.height - 1;
    onMove(atEnd ? length : (line?.offset ?? chunks[visible].startOffset));
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

  return (
    <ScrollView
      ref={scroll}
      style={{ flex: 1 }}
      scrollEventThrottle={64}
      maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
      contentContainerStyle={{ paddingHorizontal: margin, paddingVertical: 12 }}
      onLayout={(e) => {
        dimensions.current.viewport = e.nativeEvent.layout.height;
        restore();
      }}
      onContentSizeChange={(_, height) => {
        dimensions.current.content = height;
        restore();
      }}
      onScrollBeginDrag={(event) => {
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
      {chunks.slice(start, end).map((chunk) => (
        <Text
          key={chunk.chunkIndex}
          style={textStyle}
          onLayout={(e) => updateFrame(chunk.chunkIndex, { top: e.nativeEvent.layout.y })}
          onTextLayout={(e) => {
            let cursor = 0;
            const lines = e.nativeEvent.lines.map((line) => {
              const match = chunk.text.indexOf(line.text, cursor);
              const local = match < 0 ? cursor : match;
              cursor = local + line.text.length;
              return { offset: chunk.startOffset + local, y: line.y };
            });
            updateFrame(chunk.chunkIndex, { lines });
          }}
        >
          <LinkedText chunk={chunk} links={links} color={linkColor} onLink={onLink} />
        </Text>
      ))}
      {end === chunks.length && footer}
    </ScrollView>
  );
}
