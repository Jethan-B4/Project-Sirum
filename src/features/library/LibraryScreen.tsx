import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { BookCard, BookRow } from '@/components/ui/book';
import { Icon, IconButton } from '@/components/ui/icon';
import { pressFeedback } from '@/components/ui/press-feedback';
import { Chip, SectionLabel, SegmentedControl } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheet';
import { documents, type LibraryDocument } from '@/db/repositories/documents';
import { useSettings } from '@/features/settings/SettingsProvider';
import { type AppTheme, useAppTheme } from '@/theme/ThemeProvider';
import { contrastText } from '@/lib/color';
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
  const { isDark, accent, colors } = useAppTheme();
  const styles = useLibraryStyles();
  const { width, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const contentWidth = width - insets.left - insets.right;

  const navMode = get(SettingKeys.deviceNavMode);
  const viewMode = get(SettingKeys.deviceViewMode);
  const gridSize = Math.min(get(SettingKeys.deviceGridSize), Math.max(2, Math.floor(contentWidth / (78 * fontScale)))) as 2 | 3 | 4;
  const cardWidth = Math.max(0, (contentWidth - 24 - 12 * (gridSize - 1)) / gridSize);
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
  const [orderPromptDismissed, setOrderPromptDismissed] = useState(false);
  const [alwaysUseChoice, setAlwaysUseChoice] = useState(true);

  // Deep link from the side drawer: /?tab=epub
  const [tabParam, setTabParam] = useState(params.tab);
  if (params.tab !== tabParam) {
    setTabParam(params.tab);
    const t = params.tab;
    if (t === 'epub' || t === 'txt' || t === 'pdf' || t === 'all') setTab(t);
  }

  const load = useCallback(async (active: () => boolean) => {
    const sheetFormats = filters.formats ?? [];
    let formats: DocumentFormat[] | undefined;
    if (tab !== 'all' && sheetFormats.length > 0) {
      formats = sheetFormats.includes(tab) ? [tab] : [];
    } else if (tab !== 'all') {
      formats = [tab];
    } else if (sheetFormats.length > 0) {
      formats = sheetFormats;
    }

    const [list, counts] = await Promise.all([
      formats?.length === 0 ? [] : documents.list({
        search: search.trim() || undefined,
        orderMode,
        sort,
        sortDirection,
        formats,
        status: filters.status,
      }),
      documents.formatCounts(),
    ]);
    if (!active()) return;
    setBooks(list);
    setFormatCounts(counts);

    // Ask-once library order prompt (plan 5.9): two or more books, no stored choice.
    if (counts.all >= 2 && !has(SettingKeys.libraryOrderMode) && !orderPromptDismissed) {
      setOrderPrompt(true);
    }
  }, [tab, search, orderMode, sort, sortDirection, filters, has, orderPromptDismissed]);

  useFocusEffect(
    useCallback(() => {
      let focused = true;
      load(() => focused).catch((e) => console.error('Library load failed', e));
      return () => { focused = false; };
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

  const chooseOrder = useCallback(
    async (mode: 'recent' | 'fixed') => {
      setOrderPrompt(false);
      setOrderPromptDismissed(true);
      if (alwaysUseChoice) {
        await set(SettingKeys.libraryOrderMode, mode);
      }
    },
    [alwaysUseChoice, set]
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
          placeholderTextColor={colors.mu}
          style={styles.searchInput}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={8} className={pressFeedback}>
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
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => setTab(key)}
                className={pressFeedback} style={[styles.tabButton, on && styles.tabButtonActive]}>
                <Text style={[styles.tabButtonText, on && styles.tabButtonTextActive]}>{label}</Text>
                {count !== undefined && (
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
        <ScrollView contentContainerStyle={styles.emptyContainer}>
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
                className={pressFeedback} style={styles.emptyPrimaryButton}
                onPress={() => router.push('/import' as never)}>
                <Icon name="add" size={18} tone="onAccent" />
                <Text style={[styles.emptyPrimaryButtonText, { color: contrastText(accent.hex) }]}>Import Books</Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
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
          columnWrapperStyle={gridSize > 1 ? { gap: 12 } : undefined}
          contentContainerStyle={styles.gridContent}
          renderItem={({ item }) => (
            <View style={{ width: cardWidth }}>
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
      <Modal
        supportedOrientations={['portrait', 'landscape']}
        visible={orderPrompt && !orderPromptDismissed}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setOrderPrompt(false);
          setOrderPromptDismissed(true);
        }}>
        <View style={styles.modalOverlay}>
          <ScrollView style={{ maxHeight: '95%', flexGrow: 0, width: '100%', maxWidth: 340 }}
            contentContainerStyle={[
              styles.modalBox,
              {
                backgroundColor: isDark ? '#1d1d22' : '#ffffff',
                borderColor: isDark ? '#32323c' : '#e4e4ec',
              },
            ]}>
            <View style={styles.modalHeaderRow}>
              <View style={[styles.modalIconBox, { backgroundColor: isDark ? '#2a2a34' : '#eef2ff' }]}>
                <Icon name="swap-vertical" size={20} tone={accent.hex} />
              </View>
              <Text style={[styles.modalTitle, { color: isDark ? '#ffffff' : '#18181b' }]}>
                Library Order
              </Text>
            </View>

            <Text style={[styles.modalBody, { color: isDark ? '#a0a0ab' : '#555562' }]}>
              Choose how you want your books arranged:
            </Text>

            <View style={styles.modalOptionsContainer}>
              <Text style={[styles.modalOptionDesc, { color: isDark ? '#92929e' : '#5e5e68' }]}>
                • <Text style={{ fontWeight: '700', color: isDark ? '#f0f0f5' : '#1a1a20' }}>Recent first:</Text> Opening a book moves it to the top.
              </Text>
              <Text style={[styles.modalOptionDesc, { color: isDark ? '#92929e' : '#5e5e68' }]}>
                • <Text style={{ fontWeight: '700', color: isDark ? '#f0f0f5' : '#1a1a20' }}>Keep my order:</Text> Preserves your sort & filter order without rearranging.
              </Text>
            </View>

            {/* Always use this choice toggle */}
            <Pressable
              onPress={() => setAlwaysUseChoice((v) => !v)}
              className={pressFeedback} style={styles.alwaysUseRow}>
              <View
                style={[
                  styles.checkboxBox,
                  {
                    borderColor: alwaysUseChoice ? accent.hex : isDark ? '#484856' : '#bbbbc6',
                    backgroundColor: alwaysUseChoice ? accent.hex : 'transparent',
                  },
                ]}>
                {alwaysUseChoice && <Icon name="checkmark" size={13} tone={contrastText(accent.hex)} />}
              </View>
              <Text style={[styles.alwaysUseText, { color: isDark ? '#e4e4eb' : '#222226' }]}>
                Always use this choice
              </Text>
            </Pressable>

            <Text style={[styles.modalNote, { color: isDark ? '#70707c' : '#888894' }]}>
              Note: You can change this choice anytime in Settings → Library.
            </Text>

            <View style={styles.modalActions}>
              <Pressable
                className={pressFeedback} style={[
                  styles.modalGhostButton,
                  {
                    backgroundColor: isDark ? '#282830' : '#f0f0f4',
                    borderColor: isDark ? '#383844' : '#dcdce2',
                  },
                ]}
                onPress={() => chooseOrder('fixed')}>
                <Text style={[styles.modalGhostButtonText, { color: isDark ? '#ffffff' : '#18181b' }]}>
                  Keep my order
                </Text>
              </Pressable>
              <Pressable
                className={pressFeedback} style={[styles.modalPrimaryButton, { backgroundColor: accent.hex }]}
                onPress={() => chooseOrder('recent')}>
                <Text style={[styles.modalPrimaryButtonText, { color: contrastText(accent.hex) }]}>Recent first</Text>
              </Pressable>
            </View>
          </ScrollView>
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
  const styles = useLibraryStyles();
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

function useLibraryStyles() {
  const theme = useAppTheme();
  return useMemo(() => createStyles(theme), [theme]);
}

const createStyles = ({ colors, accent }: AppTheme) => StyleSheet.create({
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
    backgroundColor: colors.sf2,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 8,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    color: colors.tx,
    padding: 0,
  },
  tabBarWrapper: {
    borderBottomWidth: 1,
    borderBottomColor: colors.ln,
    backgroundColor: colors.bg,
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
    backgroundColor: colors.sf2,
  },
  tabButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.mu,
  },
  tabButtonTextActive: {
    color: colors.tx,
    fontWeight: '600',
  },
  tabCountBadge: {
    backgroundColor: colors.sf,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tabCountBadgeActive: {
    backgroundColor: accent.hex,
  },
  tabCountText: {
    fontSize: 11,
    color: colors.mu,
    fontWeight: '600',
  },
  tabCountTextActive: {
    color: contrastText(accent.hex),
  },
  gridContent: {
    padding: 12,
    paddingBottom: 32,
    gap: 12,
  },
  listContent: {
    padding: 16,
    paddingBottom: 32,
  },
  emptyContainer: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    paddingBottom: 40,
  },
  emptyIconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.sf2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.tx,
    textAlign: 'center',
    marginBottom: 8,
  },
  emptySubtitle: {
    fontSize: 14,
    color: colors.mu,
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
    backgroundColor: accent.hex,
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 12,
    shadowColor: accent.hex,
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
    backgroundColor: 'rgba(0,0,0,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalBox: {
    borderRadius: 24,
    padding: 22,
    width: '100%',
    maxWidth: 340,
    borderWidth: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.45,
    shadowRadius: 16,
    elevation: 10,
  },
  modalHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalIconBox: {
    width: 38,
    height: 38,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    flex: 1,
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginTop: 12,
  },
  modalOptionsContainer: {
    marginTop: 10,
    gap: 6,
  },
  modalOptionDesc: {
    fontSize: 13,
    lineHeight: 18,
  },
  alwaysUseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 16,
    paddingVertical: 4,
  },
  checkboxBox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  alwaysUseText: {
    fontSize: 13.5,
    fontWeight: '600',
  },
  modalNote: {
    fontSize: 12,
    lineHeight: 16,
    marginTop: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 20,
  },
  modalGhostButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 20,
    borderWidth: 1,
  },
  modalGhostButtonText: {
    fontWeight: '600',
    fontSize: 13.5,
  },
  modalPrimaryButton: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 20,
  },
  modalPrimaryButtonText: {
    color: '#ffffff',
    fontWeight: '600',
    fontSize: 13.5,
  },
});
