import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

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

/** ~80-char snippet of chapter text around a global UTF-16 offset. */
function snippetAt(chapters: ReaderChapter[], globalOffset: number): string {
  const ch = chapters.find(
    (c, i) =>
      globalOffset >= c.start_offset &&
      (i === chapters.length - 1 || globalOffset < chapters[i + 1].start_offset)
  );
  if (!ch) return '';
  const local = Math.max(0, globalOffset - ch.start_offset);
  const start = Math.max(0, local - 40);
  return ch.text.slice(start, local + 60).replace(/\s+/g, ' ').trim();
}

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
  /** Jump to a chapter index, optionally at a 0–1 fraction of that chapter. */
  onJumpChapter(index: number, fraction?: number): void;
  /** Jump to a global UTF-16 offset. */
  onJumpOffset(offset: number): void;
  onDeleteBookmark(id: string): void;
  onDeleteHighlight(id: string): void;
}) {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('toc');

  const chapterTitle = (index: number) =>
    chapters[index]?.title ?? `Chapter ${index + 1}`;

  const bookmarkFraction = (b: BookmarkRow) =>
    b.chapter_char_offset && chapters[b.chapter_index]?.char_count
      ? b.chapter_char_offset / chapters[b.chapter_index].char_count
      : undefined;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 flex-row justify-end">
        <Pressable className="absolute inset-0 bg-black/55" onPress={onClose} />
        <View
          className="bg-surface h-full"
          style={{ width: '78%', maxWidth: 340, paddingTop: insets.top }}>
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
                  style={{ borderBottomColor: on ? 'rgb(var(--ac))' : 'transparent' }}>
                  <Icon name={icon} size={20} tone={on ? 'default' : 'muted'} />
                </Pressable>
              );
            })}
          </View>

          <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
            {tab === 'toc' &&
              chapters.map((ch, i) => {
                const on = i === currentIndex;
                return (
                  <Pressable
                    key={ch.chapter_index}
                    onPress={() => {
                      onClose();
                      onJumpChapter(i);
                    }}
                    className="px-6 py-3.5"
                    style={on ? { backgroundColor: 'rgb(var(--acb))' } : undefined}>
                    <Text
                      numberOfLines={2}
                      className="font-ui text-[15px]"
                      style={{ color: on ? 'rgb(var(--ac))' : 'rgb(var(--tx))' }}>
                      {ch.title ?? `Chapter ${i + 1}`}
                    </Text>
                  </Pressable>
                );
              })}

            {tab === 'ann' &&
              (highlights.length === 0 ? (
                <Text className="font-ui text-mu px-6 py-8">
                  No highlights or notes yet.
                </Text>
              ) : (
                highlights.map((h) => {
                  const snippet = snippetAt(chapters, h.start_offset);
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
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
