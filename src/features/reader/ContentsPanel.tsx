import { ReaderOverlay } from './ReaderOverlay';
import React, { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/ThemeProvider';
import { contrastText } from '@/lib/color';
import { Icon, type IconName } from '@/components/ui/icon';
import { pressFeedback } from '@/components/ui/press-feedback';
import type { BookmarkRow } from '@/db/repositories/bookmarks';
import type { HighlightRow } from '@/db/repositories/highlights';
import type { ReaderChapter } from './types';
import { decodeHighlightStyle } from './textSelection';

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
  onUpdateHighlightNote,
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
  onUpdateHighlightNote(id: string, note: string): void;
}) {
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();
  const { fontScale } = useWindowDimensions();
  const rowHeight = Math.max(52, Math.ceil(42 * fontScale + 12));
  const [tab, setTab] = useState<Tab>('toc');
  const [menuId, setMenuId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

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
          const start = Math.max(0, highlight.start_offset - row.start_offset);
          const end = Math.max(start, highlight.end_offset - row.start_offset);
          next[highlight.id] = text.slice(start, end).trim();
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
    <ReaderOverlay inline visible={visible} onClose={onClose}>
      <View pointerEvents="box-none" className="flex-1 flex-row justify-end">
        <View
          className="bg-surface h-full"
          style={{ width: '78%', maxWidth: 340, paddingTop: insets.top, paddingRight: insets.right, paddingBottom: insets.bottom }}>
          {/* Tab bar */}
          <View className="flex-row border-b border-line pt-3">
            <Pressable accessibilityRole="button" accessibilityLabel="Close contents" onPress={onClose}
              className={`items-center justify-center px-3 ${pressFeedback}`}><Icon name="close" size={20} /></Pressable>
            {TABS.map(([key, icon, label]) => {
              const on = tab === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityState={{ selected: on }}
                  onPress={() => setTab(key)}
                  className={`flex-1 items-center pb-2 border-b-[3px] ${pressFeedback}`}
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
                    className={`px-6 justify-center ${pressFeedback}`}
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
                  const color = decodeHighlightStyle(h.color).color;
                  return (
                    <View key={h.id} className="px-6 py-3.5 border-b border-line">
                      <View className="flex-row items-start gap-2">
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Open highlighted passage"
                          className={`flex-1 flex-row items-start gap-3 ${pressFeedback}`}
                          onPress={() => {
                            onClose();
                            onJumpOffset(h.start_offset);
                          }}>
                          <View className="mt-1 h-5 w-5 rounded-full border border-line"
                            style={{ backgroundColor: color ?? 'transparent' }}>
                            {!color && <Icon name="color-fill" size={15} tone="muted" />}
                          </View>
                          <View className="flex-1 min-w-0">
                            <Text className="font-ui text-mu text-[11px] font-semibold tracking-wider">
                              HIGHLIGHTED TEXT
                            </Text>
                            <Text numberOfLines={5} className="font-ui text-tx text-[14px] mt-1">
                              {snippet || 'Selected text unavailable'}
                            </Text>
                            {!!h.note && (
                              <View className="mt-2 border-l-2 border-line pl-2">
                                <Text className="font-ui text-mu text-[11px] font-semibold tracking-wider">YOUR NOTE</Text>
                                <Text numberOfLines={4} className="font-ui text-tx text-[14px] mt-1">{h.note}</Text>
                              </View>
                            )}
                            <Text className="font-ui text-mu text-[12px] mt-2">
                              {chapterTitle(h.chapter_index)}
                            </Text>
                          </View>
                        </Pressable>
                        <View>
                          <Pressable
                            accessibilityRole="button"
                            accessibilityLabel="Highlight options"
                            accessibilityState={{ expanded: menuId === h.id }}
                            onPress={() => setMenuId(menuId === h.id ? null : h.id)}
                            className={`p-1 ${pressFeedback}`}>
                            <Icon name="ellipsis-vertical" size={18} tone="muted" />
                          </Pressable>
                          {menuId === h.id && (
                            <View className="absolute top-9 right-0 z-10 rounded-lg border border-line bg-surface px-2 py-1 shadow">
                              <Pressable accessibilityRole="button" onPress={() => {
                                setNoteDraft(h.note ?? '');
                                setEditingId(h.id);
                                setMenuId(null);
                              }} className={`px-3 py-2 ${pressFeedback}`}>
                                <Text className="font-ui text-tx text-[13px]">{h.note ? 'Edit note' : 'Add note'}</Text>
                              </Pressable>
                              <Pressable accessibilityRole="button" onPress={() => {
                                onDeleteHighlight(h.id);
                                setMenuId(null);
                              }} className={`px-3 py-2 ${pressFeedback}`}>
                                <Text className="font-ui text-tx text-[13px]">Delete highlight</Text>
                              </Pressable>
                            </View>
                          )}
                        </View>
                      </View>
                      {editingId === h.id && (
                        <View className="mt-2">
                          <TextInput value={noteDraft} onChangeText={setNoteDraft} multiline
                            placeholder="Add a note" className="font-ui text-tx text-[14px] rounded-lg border border-line bg-surface px-3 py-2" />
                          <View className="flex-row justify-end gap-3 mt-2">
                            <Pressable accessibilityRole="button" onPress={() => setEditingId(null)} className={`px-2 py-1 ${pressFeedback}`}>
                              <Text className="font-ui text-mu text-[13px]">Cancel</Text>
                            </Pressable>
                            <Pressable accessibilityRole="button" onPress={() => {
                              onUpdateHighlightNote(h.id, noteDraft.trim());
                              setEditingId(null);
                            }} className={`px-2 py-1 ${pressFeedback}`}>
                              <Text className="font-ui text-[13px]" style={{ color: accent.hex }}>Save note</Text>
                            </Pressable>
                          </View>
                        </View>
                      )}
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
                        className={`flex-1 px-6 py-3.5 ${pressFeedback}`}
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
                        className={`p-2 mr-2 ${pressFeedback}`}>
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
