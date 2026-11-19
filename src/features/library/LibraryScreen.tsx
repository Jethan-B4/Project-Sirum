import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { BookCard, BookRow } from '@/components/ui/book';
import { Icon, IconButton } from '@/components/ui/icon';
import { Chip, SectionLabel, SegmentedControl } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheet';
import { documents, type LibraryDocument } from '@/db/repositories/documents';
import { useSettings } from '@/features/settings/SettingsProvider';
import {
  SettingKeys,
  type DocumentFormat,
  type LibraryFilters,
  type ReadingStatus,
} from '@/lib/settingsKeys';

const FORMATS: DocumentFormat[] = ['epub', 'txt', 'pdf'];
const TABS: { key: 'all' | DocumentFormat; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'epub', label: 'EPUB' },
  { key: 'txt', label: 'TXT' },
  { key: 'pdf', label: 'PDF' },
];
const STATUS_OPTIONS: readonly (readonly [ReadingStatus, string])[] = [
  ['unread', 'Unread'],
  ['inProgress', 'In progress'],
  ['finished', 'Finished'],
];

export default function LibraryScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string }>();
  const { get, set, has } = useSettings();
  const { toast, openDrawer } = useChrome();

  const navMode = get(SettingKeys.deviceNavMode);
  const viewMode = get(SettingKeys.deviceViewMode);
  const gridSize = get(SettingKeys.deviceGridSize);
  const showBadges = get(SettingKeys.deviceShowBadges);
  const showDetails = get(SettingKeys.deviceShowDetails);
  const orderMode = get(SettingKeys.libraryOrderMode);
  const sort = get(SettingKeys.librarySort);
  const sortDirection = get(SettingKeys.librarySortDirection);
  const filters = get(SettingKeys.libraryFilters);

  const [tab, setTab] = useState<'all' | DocumentFormat>('all');
  const [search, setSearch] = useState('');
  const [findOpen, setFindOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [books, setBooks] = useState<LibraryDocument[]>([]);
  const [formatCounts, setFormatCounts] = useState<Record<string, number>>({});
  const [orderPrompt, setOrderPrompt] = useState(false);

  // Deep link from the side drawer: /?tab=epub
  const [tabParam, setTabParam] = useState(params.tab);
  if (params.tab !== tabParam) {
    setTabParam(params.tab);
    const t = params.tab;
    if (t === 'epub' || t === 'txt' || t === 'pdf' || t === 'all') setTab(t);
  }

  const load = useCallback(async () => {
    const sheetFormats = filters.formats ?? [];
    let formats: DocumentFormat[] | undefined;
    if (tab !== 'all' && sheetFormats.length > 0) {
      formats = sheetFormats.includes(tab) ? [tab] : [];
    } else if (tab !== 'all') {
      formats = [tab];
    } else if (sheetFormats.length > 0) {
      formats = sheetFormats;
    }

    const [list, all] = await Promise.all([
      documents.list({
        search: search.trim() || undefined,
        orderMode,
        sort,
        sortDirection,
        formats,
        status: filters.status,
      }),
      documents.list({ orderMode }),
    ]);
    setBooks(list);
    const counts: Record<string, number> = { all: all.length };
    for (const f of FORMATS) counts[f] = all.filter((b) => b.format === f).length;
    setFormatCounts(counts);

    // Ask-once library order prompt (plan 5.9): two or more books, no stored choice.
    if (all.length >= 2 && !has(SettingKeys.libraryOrderMode)) {
      setOrderPrompt(true);
    }
  }, [tab, search, orderMode, sort, sortDirection, filters, has]);

  useFocusEffect(
    useCallback(() => {
      load().catch((e) => console.error('Library load failed', e));
    }, [load])
  );

  const openBook = useCallback(
    async (book: LibraryDocument) => {
      if (book.local_uri == null) {
        toast(`Import “${book.title}” to continue reading`);
        return;
      }
      documents.touchOpened(book.id).catch(() => {});
      router.push(`/reader/${book.id}` as never);
    },
    [router, toast]
  );

  const header = findOpen ? (
    <View style={styles.searchHeader}>
      {navMode === 'side' && <IconButton icon="menu" label="Menu" onPress={openDrawer} />}
      <View style={styles.searchInputWrapper}>
        <Icon name="search" size={18} tone="muted" />
        <TextInput
          autoFocus
          value={search}
          onChangeText={setSearch}
          placeholder="Search titles or authors…"
          placeholderTextColor="rgb(var(--mu))"
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8}>
            <Icon name="close-circle" size={18} tone="muted" />
          </Pressable>
        )}
      </View>
      <IconButton
        icon="close"
        label="Close search"
        onPress={() => {
          setFindOpen(false);
          setSearch('');
        }}
      />
    </View>
  ) : (
    <AppBar
      title={navMode === 'side' ? 'My Books' : 'Library'}
      count={books.length}
      leading={navMode === 'side' ? 'menu' : 'none'}
      actions={[
        { icon: 'search', label: 'Search', onPress: () => setFindOpen(true) },
        { icon: 'options-outline', label: 'View, sort and filter', onPress: () => setSheetOpen(true) },
      ]}
    />
  );

  const tabs =
    navMode === 'bottom' ? (
      <View style={styles.tabBarWrapper}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabBarContent}>
          {TABS.map(({ key, label }) => {
            const count = formatCounts[key];
            const on = tab === key;
            return (
              <Pressable
                key={key}
                onPress={() => setTab(key)}
                style={[styles.tabButton, on && styles.tabButtonActive]}>
                <Text style={[styles.tabButtonText, on && styles.tabButtonTextActive]}>{label}</Text>
                {count !== undefined && count > 0 && (
                  <View style={[styles.tabCountBadge, on && styles.tabCountBadgeActive]}>
                    <Text style={[styles.tabCountText, on && styles.tabCountTextActive]}>{count}</Text>
                  </View>
                )}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    ) : null;

  return (
    <Screen>
      {header}
      {tabs}

      {books.length === 0 ? (
        <View style={styles.emptyContainer}>
          <View style={styles.emptyIconCircle}>
            <Icon name="book" size={36} tone="accent" />
          </View>
          <Text style={styles.emptyTitle}>
            {search || filters.status?.length || filters.formats?.length || tab !== 'all'
              ? 'No matching books found'
              : 'Your library is empty'}
          </Text>
          <Text style={styles.emptySubtitle}>
            {search || filters.status?.length || filters.formats?.length || tab !== 'all'
              ? 'Try adjusting your search terms or clearing filters.'
              : 'Import EPUB or TXT books to start reading offline with synchronized progress.'}
          </Text>

          {!search && !(filters.status?.length || filters.formats?.length) && tab === 'all' && (
            <View style={styles.emptyActionsRow}>
              <Pressable
                style={styles.emptyPrimaryButton}
                onPress={() => router.push('/import' as never)}>
                <Icon name="add" size={18} tone="onAccent" />
                <Text style={styles.emptyPrimaryButtonText}>Import Books</Text>
              </Pressable>
            </View>
          )}
        </View>
      ) : viewMode === 'list' ? (
        <FlatList
          data={books}
          keyExtractor={(b) => b.id}
          renderItem={({ item }) => <BookRow book={item} onPress={openBook} />}
          contentContainerStyle={styles.listContent}
        />
      ) : (
        <FlatList
          data={books}
          key={`grid-${gridSize}`}
          keyExtractor={(b) => b.id}
          numColumns={gridSize}
          columnWrapperStyle={gridSize > 1 ? { gap: 14 } : undefined}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => (
            <View style={{ flex: 1 }}>
              <BookCard
                book={item}
                gridSize={gridSize}
                showBadges={showBadges}
                showDetails={showDetails}
                onPress={openBook}
              />
            </View>
          )}
        />
      )}

      <FilterSheet
        visible={sheetOpen}
        onClose={() => setSheetOpen(false)}
        filters={filters}
        orderMode={orderMode}
        sort={sort}
        sortDirection={sortDirection}
      />

      {/* Ask-once: library order (plan 5.9) */}
      <Modal visible={orderPrompt} transparent animationType="fade" onRequestClose={() => setOrderPrompt(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalBox}>
            <Text style={styles.modalTitle}>How should your library be ordered?</Text>
            <Text style={styles.modalBody}>
              Move the book you open to the top (Recent), or keep a fixed order using your chosen sort and filters.
              You can adjust this anytime in Settings → Library.
            </Text>
            <View style={styles.modalActions}>
              <Pressable
                style={styles.modalGhostButton}
                onPress={async () => {
                  await set(SettingKeys.libraryOrderMode, 'fixed');
                  setOrderPrompt(false);
                  load();
                }}>
                <Text style={styles.modalGhostButtonText}>Keep my order</Text>
              </Pressable>
              <Pressable
                style={styles.modalPrimaryButton}
                onPress={async () => {
                  await set(SettingKeys.libraryOrderMode, 'recent');
                  setOrderPrompt(false);
                  load();
                }}>
                <Text style={styles.modalPrimaryButtonText}>Recent first</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}

// --- Filter / sort / view bottom sheet ----------------------------------------

function FilterSheet({
  visible,
  onClose,
  filters,
  orderMode,
  sort,
  sortDirection,
}: {
  visible: boolean;
  onClose: () => void;
  filters: LibraryFilters;
  orderMode: 'recent' | 'fixed';
  sort: 'title' | 'author' | 'added' | 'lastRead' | 'progress';
  sortDirection: 'asc' | 'desc';
}) {
  const { get, set } = useSettings();
  const viewMode = get(SettingKeys.deviceViewMode);
  const gridSize = get(SettingKeys.deviceGridSize);
  const sortDisabled = orderMode === 'recent';

  const toggle = <T,>(list: T[] | undefined, v: T): T[] => {
    const arr = list ?? [];
    return arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];
  };

  const applyFilters = async (patch: Partial<LibraryFilters>) => {
    await set(SettingKeys.libraryFilters, { ...filters, ...patch });
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} title="View, sort and filter">
      <SectionLabel>Layout</SectionLabel>
      <SegmentedControl<'grid' | 'list'>
        options={[
          ['grid', 'Grid View'],
          ['list', 'List View'],
        ]}
        value={viewMode}
        onChange={async (v) => {
          await set(SettingKeys.deviceViewMode, v);
        }}
      />

      <SectionLabel>Grid Columns</SectionLabel>
      <SegmentedControl<number>
        options={[
          [2, '2 Columns'],
          [3, '3 Columns'],
          [4, '4 Columns'],
        ]}
        value={gridSize}
        disabled={viewMode === 'list'}
        onChange={async (v) => {
          await set(SettingKeys.deviceGridSize, v as 2 | 3 | 4);
          await set(SettingKeys.deviceViewMode, 'grid');
        }}
      />

      <SectionLabel>
        Sort Order{sortDisabled ? ' (Disabled while Recently Opened is active)' : ''}
      </SectionLabel>
      <SegmentedControl
        options={[
          ['title', 'Title'],
          ['author', 'Author'],
          ['added', 'Date added'],
          ['lastRead', 'Last read'],
          ['progress', 'Progress'],
        ]}
        value={sort}
        disabled={sortDisabled}
        onChange={(v) => set(SettingKeys.librarySort, v)}
      />
      <SegmentedControl
        options={[
          ['asc', 'Ascending (A–Z)'],
          ['desc', 'Descending (Z–A)'],
        ]}
        value={sortDirection}
        disabled={sortDisabled}
        onChange={(v) => set(SettingKeys.librarySortDirection, v)}
      />

      <SectionLabel>Format Filter</SectionLabel>
      <View style={styles.chipRow}>
        {FORMATS.map((f) => (
          <Chip
            key={f}
            label={f.toUpperCase()}
            selected={(filters.formats ?? []).includes(f)}
            onPress={() => applyFilters({ formats: toggle(filters.formats, f) as DocumentFormat[] })}
          />
        ))}
      </View>

      <SectionLabel>Reading Status</SectionLabel>
      <View style={styles.chipRow}>
        {STATUS_OPTIONS.map(([v, label]) => (
          <Chip
            key={v}
            label={label}
            selected={(filters.status ?? []).includes(v)}
            onPress={() => applyFilters({ status: toggle(filters.status, v) as ReadingStatus[] })}
          />
        ))}
      </View>

      <View style={styles.sheetDoneRow}>
        <Chip label="Done" selected onPress={onClose} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  searchHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 12,
  },
  searchInputWrapper: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgb(var(--surface-2))',
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: 'rgb(var(--tx))',
    padding: 0,
  },
  tabBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: 'rgb(var(--ln))',
    backgroundColor: 'rgb(var(--bg))',
  },
  tabBarContent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
  },
  tabButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 20,
    backgroundColor: 'transparent',
    gap: 6,
  },
  tabButtonActive: {
    backgroundColor: 'rgb(var(--surface-2))',
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: 'rgb(var(--mu))',
  },
  tabButtonTextActive: {
    color: 'rgb(var(--tx))',
    fontWeight: '600',
  },
  tabCountBadge: {
    backgroundColor: 'rgb(var(--surface))',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabCountBadgeActive: {
    backgroundColor: 'rgb(var(--ac))',
  },
  tabCountText: {
    fontSize: 11,
    color: 'rgb(var(--mu))',
    fontWeight: '600',
  },
  tabCountTextActive: {
    color: '#ffffff',
  },
  gridContent: {
    padding: 16,
    paddingBottom: 32,
    gap: 16,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: 'rgb(var(--surface-2))',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: 'rgb(var(--tx))',
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: 'rgb(var(--mu))',
    textAlign: 'center',
    lineHeight: 20,
    maxWidth: 280,
  },
  emptyActionsRow: {
    flexDirection: 'row',
    marginTop: 24,
    gap: 12,
  },
  emptyPrimaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgb(var(--ac))',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: 'rgb(var(--ac))',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 3,
  },
  emptyPrimaryButtonText: {
    color: '#ffffff',
    fontSize: 15,
    fontWeight: '600',
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginVertical: 4,
  },
  sheetDoneRow: {
    alignItems: 'flex-end',
    marginTop: 16,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalBox: {
    backgroundColor: 'rgb(var(--surface))',
    borderRadius: 20,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 6,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: 'rgb(var(--tx))',
  },
  modalBody: {
    fontSize: 14,
    color: 'rgb(var(--mu))',
    lineHeight: 20,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 18,
  },
  modalGhostButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
  },
  modalGhostButtonText: {
    color: 'rgb(var(--ac))',
    fontWeight: '600',
    fontSize: 14,
  },
  modalPrimaryButton: {
    backgroundColor: 'rgb(var(--ac))',
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  modalPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 14,
  },
});
