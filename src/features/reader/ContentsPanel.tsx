import { ReaderOverlay } from './ReaderOverlay';
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/ThemeProvider';
import { contrastText } from '@/lib/color';
import { Icon, type IconName } from '@/components/ui/icon';
import type { BookmarkRow } from '@/db/repositories/bookmarks';
import type { HighlightRow } from '@/db/repositories/highlights';
import type { ReaderChapter } from './types';

type Tab = 'toc' | 'ann' | 'bm';

const TABS: readonly (readonly [Tab, IconName, string])[] = [
  ['toc', 'list', 'Contents'],
  ['ann', 'pencil', 'Annotations'],
  ['bm', 'bookmark', 'Bookmarks'],
];

/**
 * Right-side contents panel (prototype `.pn`): Contents / Annotations /
 * Bookmarks tabs. Tapping an item jumps to that position in the book.
 */
export function ContentsPanel({
  visible,
  onClose,
  chapters,
  currentIndex,
  bookmarks,
  highlights,
  readChapter,
  onJumpChapter,
  onJumpOffset,
  onDeleteBookmark,
  onDeleteHighlight,
}: {
  visible: boolean;
  onClose: () => void;
  chapters: ReaderChapter[];
  currentIndex: number;
  bookmarks: BookmarkRow[];
  highlights: HighlightRow[];
  readChapter(index: number): Promise<string>;
  /** Jump to a chapter index, optionally at a 0–1 fraction of that chapter. */
  onJumpChapter(index: number, fraction?: number): void;
  /** Jump to a global UTF-16 offset. */
  onJumpOffset(offset: number): void;
  onDeleteBookmark(id: string): void;
  onDeleteHighlight(id: string): void;
}) {
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(52, Math.ceil(42 * fontScale + 12));
  const [tab, setTab] = useState<Tab>('toc');

  const [snippets, setSnippets] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!visible || tab !== 'ann') return;
    let cancelled = false;
    (async () => {
      const next: Record<string, string> = {};
      const grouped = new Map<number, HighlightRow[]>();
      for (const highlight of highlights) {
        const group = grouped.get(highlight.chapter_index) ?? [];
        group.push(highlight);
        grouped.set(highlight.chapter_index, group);
      }
      for (const [index, group] of grouped) {
        if (cancelled) return;
        const row = chapters[index];
        if (!row) continue;
        const text = await readChapter(row.chapter_index).catch(() => '');
        for (const highlight of group) {
          const offset = highlight.start_offset - row.start_offset;
          next[highlight.id] = text.slice(Math.max(0, offset - 40), offset + 60).trim();
        }
      }
      if (!cancelled) setSnippets(next);
    })();
    return () => { cancelled = true; };
  }, [chapters, highlights, readChapter, tab, visible]);

  const chapterTitle = (index: number) =>
    chapters[index]?.title ?? `Chapter ${index + 1}`;

  const bookmarkFraction = (b: BookmarkRow) =>
    b.chapter_char_offset && chapters[b.chapter_index]?.char_count
      ? b.chapter_char_offset / chapters[b.chapter_index].char_count
      : undefined;

  return (
    <ReaderOverlay visible={visible} onClose={onClose}>
      <View className="flex-1 flex-row justify-end">
        <Pressable className="absolute inset-0 bg-black/55" onPress={onClose} />
        <View
          className="bg-surface h-full"
          style={{ width: '78%', maxWidth: 340, paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom }}>
          {/* Tab bar */}
          <View className="flex-row border-b border-line pt-3">
            {TABS.map(([key, icon, label]) => {
              const on = tab === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: on }}
                  onPress={() => setTab(key)}
                  className="flex-1 items-center pb-2 border-b-[3px]"
                  style={{ borderBottomColor: on ? accent.hex : 'transparent' }}>
                  <Icon name={icon} size={20} tone={on ? 'default' : 'muted'} />
                </Pressable>
              );
            })}
          </View>

          {tab === 'toc' ? (
            <FlatList data={chapters}
              initialScrollIndex={chapters.length ? currentIndex : undefined}
              getItemLayout={(_, index) => ({ length: rowHeight, offset: rowHeight * index, index })}
              keyExtractor={(ch) => String(ch.chapter_index)}
              renderItem={({ item: ch, index: i }) => {
                const on = i === currentIndex;
                return (
                  <Pressable
                    key={ch.chapter_index}
                    onPress={() => {
                      onClose();
                      onJumpChapter(i);
                    }}
                    className="px-6 justify-center"
                    style={{ height: rowHeight, backgroundColor: on ? accent.hexStrong : undefined }}>
                    <Text
                      numberOfLines={2}
                      className="font-ui text-tx text-[15px]"
                      style={on ? { color: contrastText(accent.hexStrong) } : undefined}>
                      {ch.title ?? `Chapter ${i + 1}`}
                    </Text>
                  </Pressable>
                );
              }} />
          ) : (
          <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
            {tab === 'ann' &&
              (highlights.length === 0 ? (
                <Text className="font-ui text-mu px-6 py-8">
                  No highlights or notes yet.
                </Text>
              ) : (
                highlights.map((h) => {
                  const snippet = snippets[h.id];
                  return (
                    <View key={h.id} className="px-6 py-3.5">
                      <Pressable
                        className="flex-row items-start gap-3"
                        onPress={() => {
                          onClose();
                          onJumpOffset(h.start_offset);
                        }}>
                        <Icon name="color-fill" size={18} tone="muted" />
                        <View className="flex-1 min-w-0">
                          {!!snippet && (
                            <Text numberOfLines={3} className="font-ui text-tx text-[14px]">
                              {snippet}
                            </Text>
                          )}
                          {!!h.note && (
                            <Text numberOfLines={2} className="font-ui text-mu text-[13px] mt-1">
                              {h.note}
                            </Text>
                          )}
                          <Text className="font-ui text-mu text-[12px] mt-1">
                            {chapterTitle(h.chapter_index)}
                          </Text>
                        </View>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete highlight"
                        onPress={() => onDeleteHighlight(h.id)}
                        className="absolute top-3 right-4 p-1">
                        <Icon name="trash-outline" size={16} tone="muted" />
                      </Pressable>
                    </View>
                  );
                })
              ))}

            {tab === 'bm' &&
              (bookmarks.length === 0 ? (
                <Text className="font-ui text-mu px-6 py-8">
                  No bookmarks yet. Use the menu, then Add bookmark.
                </Text>
              ) : (
                bookmarks.map((b) => {
                  const frac = bookmarkFraction(b);
                  return (
                    <View key={b.id} className="flex-row items-center">
                      <Pressable
                        className="flex-1 px-6 py-3.5"
                        onPress={() => {
                          onClose();
                          onJumpChapter(b.chapter_index, frac);
                        }}>
                        <Text numberOfLines={1} className="font-ui text-tx text-[15px]">
                          {chapterTitle(b.chapter_index)}
                        </Text>
                        <Text className="font-ui text-mu text-[13px]">
                          {frac != null ? `${Math.round(frac * 100)}% of chapter` : 'Bookmark'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Delete bookmark"
                        onPress={() => onDeleteBookmark(b.id)}
                        className="p-2 mr-2">
                        <Icon name="trash-outline" size={16} tone="muted" />
                      </Pressable>
                    </View>
                  );
                })
              ))}
          </ScrollView>)}
        </View>
      </View>
    </ReaderOverlay>
  );
}
