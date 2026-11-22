import React, { useEffect, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/theme/ThemeProvider';
import { Icon } from '@/components/ui/icon';
import type { ReaderChapter, SearchResult } from './types';

import { searchBook } from './searchBook';

/**
 * Full-screen in-book search (prototype `.sv`): empty query shows recent
 * searches (device-local history, last 10); typing shows live results with
 * the match highlighted; tapping a result jumps to that position.
 */
export function SearchOverlay({
  visible,
  onClose,
  chapters,
  readChapter,
  history,
  onAddHistory,
  onClearHistory,
  onResult,
}: {
  visible: boolean;
  onClose: () => void;
  chapters: ReaderChapter[];
  readChapter(index: number): Promise<string>;
  history: string[];
  onAddHistory(query: string): void;
  onClearHistory(): void;
  onResult(result: SearchResult): void;
}) {
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();
  const [query, setQuery] = useState('');

  const [scan, setScan] = useState({ query: '', results: [] as SearchResult[], status: '' });
  const results = scan.query === query ? scan.results : [];
  const status = scan.query === query ? scan.status : 'Searching...';
  useEffect(() => {
    if (!visible || !query.trim()) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      searchBook(
        chapters,
        query,
        readChapter,
        () => cancelled,
        (next) => {
          if (!cancelled) setScan({ query, results: next, status: 'Searching...' });
        },
      )
        .then((skipped) => {
          if (cancelled) return;
          const status = skipped ? 'Some chapters could not be searched.' : '';
          setScan((prev) => ({ query, results: prev.query === query ? prev.results : [], status }));
        })
        .catch(() => {
          if (!cancelled) setScan({ query, results: [], status: 'Search could not finish.' });
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [visible, query, chapters, readChapter]);

  const submit = () => {
    const q = query.trim();
    if (q) onAddHistory(q);
  };

  if (!visible) return null;
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-surface" style={{ paddingTop: insets.top }}>
        {/* Search bar */}
        <View className="flex-row items-center gap-1 px-2 pt-2 pb-2">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back"
            onPress={onClose}
            className="w-11 h-11 items-center justify-center"
          >
            <Icon name="arrow-back" size={22} tone="default" />
          </Pressable>
          <TextInput
            autoFocus
            value={query}
            onChangeText={setQuery}
            onSubmitEditing={submit}
            placeholder="Search in book"
            returnKeyType="search"
            className="flex-1 bg-surface-2 rounded-full px-4 py-2.5 font-ui text-tx text-[16px]"
          />
          {query.length > 0 && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear search"
              onPress={() => setQuery('')}
              className="w-11 h-11 items-center justify-center"
            >
              <Icon name="close" size={20} tone="muted" />
            </Pressable>
          )}
        </View>

        {!query.trim() ? (
          <ScrollView keyboardShouldPersistTaps="handled">
            {history.map((h, i) => (
              <Pressable
                key={`${h}-${i}`}
                onPress={() => setQuery(h)}
                className="flex-row items-center gap-5 px-5 py-4"
              >
                <Icon name="time-outline" size={18} tone="muted" />
                <Text className="font-ui text-tx text-[16px] flex-1">{h}</Text>
              </Pressable>
            ))}
            {history.length > 0 && (
              <Pressable onPress={onClearHistory} className="px-5 py-4">
                <Text className="font-ui text-mu text-[13px]">Clear history</Text>
              </Pressable>
            )}
          </ScrollView>
        ) : results.length === 0 ? (
          <Text className="font-ui text-mu px-6 py-8">{status || 'No matches in this book.'}</Text>
        ) : (
          <FlatList
            ListFooterComponent={
              status ? <Text className="font-ui text-mu px-6 py-3">{status}</Text> : undefined
            }
            data={results}
            keyboardShouldPersistTaps="handled"
            keyExtractor={(row) => row.chapterIndex + '-' + row.chapterOffset}
            renderItem={({ item: r }) => (
              <Pressable
                onPress={() => {
                  onAddHistory(query.trim());
                  onResult(r);
                }}
                className="px-5 py-3.5 border-b border-line"
              >
                <Text className="font-ui text-tx text-[14px] leading-5">
                  {r.before}
                  <Text className="font-ui font-semibold" style={{ color: accent.hex }}>
                    {r.match}
                  </Text>
                  {r.after}
                </Text>
                <Text className="font-ui text-mu text-[12px] mt-1">{r.chapterTitle}</Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
