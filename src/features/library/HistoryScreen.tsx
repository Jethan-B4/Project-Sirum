import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useDeferredValue, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Text, TextInput, View } from 'react-native';

import { AppBar, Screen } from '@/components/chrome/app-bar';
import { IconButton } from '@/components/ui/icon';
import { useAppTheme } from '@/theme/ThemeProvider';
import { BookRow } from '@/components/ui/book';
import { SectionLabel, SegmentedControl } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheet';
import { documents, type HistoryDocument } from '@/db/repositories/documents';
import { useSettings } from '@/features/settings/SettingsProvider';
import { FINISHED_THRESHOLD, SettingKeys } from '@/lib/settingsKeys';

export default function HistoryScreen() {
  const router = useRouter();
  const { get } = useSettings();
  const navMode = get(SettingKeys.deviceNavMode);
  const [books, setBooks] = useState<HistoryDocument[] | null>(null);
  const [failed, setFailed] = useState(false);
  const { colors } = useAppTheme();
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const term = useDeferredValue(query.trim().toLocaleLowerCase());
  const [showOptions, setShowOptions] = useState(false);
  const [order, setOrder] = useState<'newest' | 'oldest'>('newest');
  const [filter, setFilter] = useState<'all' | 'reading' | 'finished'>('all');

  useFocusEffect(
    useCallback(() => {
      let active = true;
      documents
        .listHistory()
        .then((rows) => {
          if (active) {
            setBooks(rows);
            setFailed(false);
          }
        })
        .catch(() => {
          if (active) setFailed(true);
        });
      return () => {
        active = false;
      };
    }, []),
  );

  const visible = useMemo(() => {
    const rows = (books ?? []).filter((book) => {
      if (term && ![book.title, book.author, book.chapter_title].some((value) => value?.toLocaleLowerCase().includes(term))) return false;
      const finished = (book.percent ?? 0) >= FINISHED_THRESHOLD;
      return filter === 'all' || (filter === 'finished' ? finished : !finished);
    });
    return order === 'oldest' ? rows.reverse() : rows;
  }, [books, filter, order, term]);

  return (
    <Screen>
      <AppBar
        title="History"
        leading={navMode === 'side' ? 'menu' : 'none'}
        actions={[
          { icon: 'search', label: 'Search reading history', onPress: () => { setSearchOpen(!searchOpen); setQuery(''); } },
          {
            icon: 'options-outline',
            label: 'Filter and sort history',
            onPress: () => setShowOptions(true),
          },
        ]}
      />
      {searchOpen && (
        <View className="mx-3 mb-2 px-3 flex-row items-center rounded-xl bg-surface">
          <TextInput autoFocus accessibilityLabel="Search reading history" value={query} onChangeText={setQuery}
            placeholder="Title, author or chapter" placeholderTextColor={colors.mu}
            className="flex-1 py-2 font-ui text-tx" returnKeyType="search" />
          <IconButton icon="close" label="Close history search" onPress={() => { setQuery(''); setSearchOpen(false); }} />
        </View>
      )}
      <FlatList
        data={visible}
        keyExtractor={(book) => book.id}
        contentContainerStyle={{ padding: 12, paddingBottom: 24 }}
        ListEmptyComponent={
          books === null && !failed ? (
            <ActivityIndicator />
          ) : (
            <Text className="font-ui text-mu text-center mt-10">
              {failed
                ? 'Could not load reading history.'
                : books?.length
                  ? term ? 'No matching books in history.' : 'No books match this filter.'
                  : 'Nothing read yet.'}
            </Text>
          )
        }
        renderItem={({ item }) => (
          <BookRow
            book={item}
            position={
              item.chapter_title?.trim() && item.chapter_title !== item.title
                ? item.chapter_title
                : 'Chapter ' + (item.chapter_index + 1)
            }
            onPress={(book) => {
              if (!book.local_uri) return;
              documents.touchOpened(book.id).catch(() => {});
              router.push(('/reader/' + book.id) as never);
            }}
          />
        )}
      />
      <BottomSheet
        visible={showOptions}
        onClose={() => setShowOptions(false)}
        title="Reading history"
      >
        <SectionLabel>Sort by last read</SectionLabel>
        <SegmentedControl
          options={[
            ['newest', 'Newest first'],
            ['oldest', 'Oldest first'],
          ]}
          value={order}
          onChange={setOrder}
        />
        <SectionLabel>Reading status</SectionLabel>
        <SegmentedControl
          options={[
            ['all', 'All'],
            ['reading', 'In progress'],
            ['finished', 'Finished'],
          ]}
          value={filter}
          onChange={setFilter}
        />
      </BottomSheet>
    </Screen>
  );
}
