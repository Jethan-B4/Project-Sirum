import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui/icon';
import type { ReaderChapter, SearchResult } from './types';

const RESULT_CAP = 200;
const SNIPPET_RADIUS = 30;

/** Case-insensitive search across chapter texts, one result per matching line. */
export function searchBook(
  chapters: ReaderChapter[],
  query: string
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const out: SearchResult[] = [];
  for (let ci = 0; ci < chapters.length && out.length < RESULT_CAP; ci++) {
    const ch = chapters[ci];
    let offset = 0;
    for (const line of ch.text.split('\n')) {
      const idx = line.toLowerCase().indexOf(q);
      if (idx >= 0 && out.length < RESULT_CAP) {
        out.push({
          chapterIndex: ci,
          chapterOffset: offset + idx,
          chapterTitle: ch.title ?? `Chapter ${ci + 1}`,
          before: line.slice(Math.max(0, idx - SNIPPET_RADIUS), idx),
          match: line.slice(idx, idx + q.length),
          after: line.slice(idx + q.length, idx + q.length + SNIPPET_RADIUS),
        });
      }
      offset += line.length + 1; // + '\n'
    }
  }
  return out;
}

/**
 * Full-screen in-book search (prototype `.sv`): empty query shows recent
 * searches (device-local history, last 10); typing shows live results with
 * the match highlighted; tapping a result jumps to that position.
 */
export function SearchOverlay({
  visible,
  onClose,
  chapters,
  history,
  onAddHistory,
  onClearHistory,
  onResult,
}: {
  visible: boolean;
  onClose: () => void;
  chapters: ReaderChapter[];
  history: string[];
  onAddHistory(query: string): void;
  onClearHistory(): void;
  onResult(result: SearchResult): void;
}) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState('');

  const results = useMemo(
    () => (query.trim() ? searchBook(chapters, query) : []),
    [chapters, query]
  );

  const submit = () => {
    const q = query.trim();
    if (q) onAddHistory(q);
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-surface" style={{ paddingTop: insets.top }}>
        {/* Search bar */}
        <View className="flex-row items-center gap-1 px-2 pt-2 pb-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onClose}
            className="w-11 h-11 items-center justify-center">
            <Icon name="arrow-back" size={22} tone="default" />
          </Pressable>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            placeholder="Search in book"
            placeholderTextColor="rgb(var(--mu))"
            returnKeyType="search"
            className="flex-1 bg-surface-2 rounded-full px-4 py-2.5 font-ui text-tx text-[16px]"
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              className="w-11 h-11 items-center justify-center">
              <Icon name="close" size={20} tone="muted" />
            </Pressable>
          )}
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {!query.trim() ? (
            <>
              {history.map((h, i) => (
                <Pressable
                  key={`${h}-${i}`}
                  onPress={() => setQuery(h)}
                  className="flex-row items-center gap-5 px-5 py-4">
                  <Icon name="time-outline" size={18} tone="muted" />
                  <Text className="font-ui text-tx text-[16px] flex-1">{h}</Text>
                </Pressable>
              ))}
              {history.length > 0 && (
                <Pressable onPress={onClearHistory} className="px-5 py-4">
                  <Text className="font-ui text-mu text-[13px]">Clear history</Text>
                </Pressable>
              )}
            </>
          ) : results.length === 0 ? (
            <Text className="font-ui text-mu px-6 py-8">No matches in this book.</Text>
          ) : (
            results.map((r, i) => (
              <Pressable
                key={i}
                onPress={() => {
                  onAddHistory(query.trim());
                  onResult(r);
                }}
                className="px-5 py-3.5 border-b border-line">
                <Text className="font-ui text-tx text-[14px] leading-5">
                  {r.before}
                  <Text className="font-ui font-semibold" style={{ color: 'rgb(var(--ac))' }}>
                    {r.match}
                  </Text>
                  {r.after}
                </Text>
                <Text className="font-ui text-mu text-[12px] mt-1">{r.chapterTitle}</Text>
              </Pressable>
            ))
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
