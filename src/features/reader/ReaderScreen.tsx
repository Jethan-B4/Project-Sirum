import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import Slider from '@react-native-community/slider';
import * as Brightness from 'expo-brightness';
import { useKeepAwake } from 'expo-keep-awake';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { Icon, IconButton } from '@/components/ui/icon';
import { bookmarks as bookmarksRepo } from '@/db/repositories/bookmarks';
import { chapters as chaptersRepo } from '@/db/repositories/chapters';
import { documents } from '@/db/repositories/documents';
import { highlights as highlightsRepo } from '@/db/repositories/highlights';
import { progress as progressRepo } from '@/db/repositories/progress';
import { useSettings } from '@/features/settings/SettingsProvider';
import {
  DEFAULT_READING_STYLE,
  normalizeStylePatch,
  readerBookKey,
  SettingKeys,
  type ReadingStyle,
} from '@/lib/settingsKeys';
import { positionFromChapterOffset, positionFromOffset } from '@/text/position';
import { ContentsPanel } from './ContentsPanel';
import { DisplayPopup } from './DisplayPopup';
import { readingFontFamily, BASE_FONT_SIZE } from './ReadingStyleEditor';
import { SearchOverlay } from './SearchOverlay';
import type { ReaderChapter, SearchResult } from './types';
import type { BookmarkRow } from '@/db/repositories/bookmarks';
import type { HighlightRow } from '@/db/repositories/highlights';
import type { DocumentRow } from '@/db/repositories/documents';

type Overlay = 'none' | 'menu' | 'panel' | 'display' | 'search';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { get, getJson, setJson, has, set, remove } = useSettings();
  const { toast } = useChrome();
  useKeepAwake();

  const percentageMode = get(SettingKeys.readerPercentageMode);
  const brightnessSetting = get(SettingKeys.deviceReaderBrightness);
  const searchHistory = get(SettingKeys.deviceSearchHistory);

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [chs, setChs] = useState<ReaderChapter[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [overlay, setOverlay] = useState<Overlay>('none');
  const [chIdx, setChIdx] = useState(0);
  const [frac, setFrac] = useState(0);
  const [bms, setBms] = useState<BookmarkRow[]>([]);
  const [hls, setHls] = useState<HighlightRow[]>([]);
  const [pmDismissed, setPmDismissed] = useState(false);

  // Display-popup scope: 'all' edits the synced default, 'book' a per-book override.
  const [scope, setScope] = useState<'all' | 'book'>('all');

  // Reading style: synced default + optional per-book override (changed fields only).
  const defaultStyle = useMemo<ReadingStyle>(
    () => ({
      ...DEFAULT_READING_STYLE,
      ...(normalizeStylePatch(
        getJson<Partial<ReadingStyle>>(SettingKeys.readerStyle)
      ) ?? {}),
    }),
    [getJson]
  );
  const bookKey = id ? readerBookKey(id) : '';
  const bookOverride = useMemo(
    () => (id ? normalizeStylePatch(getJson<Partial<ReadingStyle>>(bookKey)) : undefined),
    [getJson, id, bookKey]
  );
  const hasOverride = !!bookOverride && Object.keys(bookOverride).length > 0;
  const style: ReadingStyle = { ...defaultStyle, ...(bookOverride ?? {}) };

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const metrics = useRef({ y: 0, viewH: 0, contentH: 0 });
  const restored = useRef(false);
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFraction = useRef<number | null>(null); // fraction to scroll to after chapter/layout
  const scrubbing = useRef(false);
  const didJump = useRef(false); // user navigated before restore resolved

  // --- Load document + chapters ---------------------------------------------
  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await documents.getById(id);
        if (!d || cancelled) return;
        setDoc(d);
        const rows = await chaptersRepo.list(id);
        const loaded: ReaderChapter[] = [];
        for (const row of rows) {
          const padded = String(row.chapter_index).padStart(4, '0');
          const file = `${d.text_dir ?? ''}/${padded}.txt`;
          let text = '';
          try {
            text = await FileSystem.readAsStringAsync(file);
          } catch {
            /* chapter file missing — render title only */
          }
          loaded.push({ ...row, text });
        }
        if (cancelled) return;
        setChs(loaded);
        const [bm, hl] = await Promise.all([
          bookmarksRepo.list(id).catch(() => [] as BookmarkRow[]),
          highlightsRepo.list(id).catch(() => [] as HighlightRow[]),
        ]);
        if (!cancelled) {
          setBms(bm);
          setHls(hl);
        }
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to open book');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const charCount = doc?.char_count ?? 0;
  const ch = chs[chIdx];

  // --- Progress persistence ---------------------------------------------------
  const positionChapters = useMemo(
    () =>
      chs.map((c) => ({
        index: c.chapter_index,
        title: c.title ?? '',
        startOffset: c.start_offset,
        charCount: c.char_count,
        text: c.text,
      })),
    [chs]
  );

  /** Current position derived from chapter index + scroll fraction. */
  const currentPosition = useCallback(
    (fraction: number) => {
      if (!ch) return null;
      const chapterCharOffset = Math.round(
        Math.min(1, Math.max(0, fraction)) * ch.char_count
      );
      return positionFromChapterOffset(chIdx, chapterCharOffset, positionChapters, charCount);
    },
    [ch, chIdx, positionChapters, charCount]
  );

  const saveProgress = useCallback(
    async (fraction: number) => {
      if (!doc || charCount <= 0) return;
      const pos = currentPosition(fraction);
      if (!pos) return;
      await progressRepo.upsert(doc.id, {
        charOffset: pos.charOffset,
        chapterIndex: pos.chapterIndex,
        chapterCharOffset: pos.chapterCharOffset,
        percent: pos.percent,
        snippet: pos.snippet,
      });
    },
    [doc, charCount, currentPosition]
  );

  const scheduleSave = useCallback(
    (fraction: number) => {
      if (pendingWrite.current) clearTimeout(pendingWrite.current);
      pendingWrite.current = setTimeout(() => {
        saveProgress(fraction).catch(() => {});
      }, 2000);
    },
    [saveProgress]
  );

  // Flush pending progress write on unmount.
  useEffect(
    () => () => {
      if (pendingWrite.current) {
        clearTimeout(pendingWrite.current);
        const m = metrics.current;
        const scrollable = m.contentH - m.viewH;
        if (scrollable > 0 && ch) {
          saveProgress(m.y / scrollable).catch(() => {});
        }
      }
    },
    [saveProgress, ch]
  );

  const onScroll = useCallback(
    (e: {
      nativeEvent: {
        contentOffset: { y: number };
        layoutMeasurement: { height: number };
        contentSize: { height: number };
      };
    }) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      metrics.current = {
        y: contentOffset.y,
        viewH: layoutMeasurement.height,
        contentH: contentSize.height,
      };
      const scrollable = contentSize.height - layoutMeasurement.height;
      const f = scrollable > 0 ? contentOffset.y / scrollable : 0;
      setFrac(f);
      if (scrollable > 0 && restored.current && !scrubbing.current) {
        scheduleSave(f);
      }
    },
    [scheduleSave]
  );

  /** Scroll to a 0–1 fraction of the current chapter once layout is known. */
  const applyPendingFraction = useCallback(() => {
    const f = pendingFraction.current;
    if (f == null) return;
    const m = metrics.current;
    const scrollable = m.contentH - m.viewH;
    if (scrollable <= 0) return;
    pendingFraction.current = null;
    scrollRef.current?.scrollTo({ y: f * scrollable, animated: false });
    setFrac(f);
  }, []);

  // Restore the saved position once, after chapters + layout are ready.
  useEffect(() => {
    if (!doc || chs.length === 0 || restored.current) return;
    progressRepo
      .get(doc.id)
      .then((p) => {
        restored.current = true;
        // A user-initiated jump while the progress row was loading wins.
        if (didJump.current || !p || p.char_offset <= 0) return;
        const pos = positionFromOffset(p.char_offset, positionChapters, charCount);
        const target = chs[pos.chapterIndex];
        if (!target) return;
        const f =
          target.char_count > 0 ? pos.chapterCharOffset / target.char_count : 0;
        pendingFraction.current = f;
        if (pos.chapterIndex !== chIdx) setChIdx(pos.chapterIndex);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, chs.length]);

  // Apply pending scroll fraction whenever content size changes (chapter switch).
  const onContentSize = useCallback(
    (_w: number, h: number) => {
      metrics.current.contentH = h;
      applyPendingFraction();
    },
    [applyPendingFraction]
  );
  const onLayout = useCallback(
    (e: { nativeEvent: { layout: { height: number } } }) => {
      metrics.current.viewH = e.nativeEvent.layout.height;
      applyPendingFraction();
    },
    [applyPendingFraction]
  );

  // --- Chapter navigation -------------------------------------------------------
  const jumpToChapter = useCallback(
    (index: number, fraction = 0) => {
      if (chs.length === 0) return;
      const clamped = Math.min(Math.max(0, index), chs.length - 1);
      const f = Math.min(1, Math.max(0, fraction));
      didJump.current = true;
      restored.current = true; // position jumps always count as real movement
      setFrac(f);
      if (clamped === chIdx) {
        // Same chapter: scroll directly when metrics are known.
        const m = metrics.current;
        const scrollable = m.contentH - m.viewH;
        if (scrollable > 0) {
          scrollRef.current?.scrollTo({ y: f * scrollable, animated: false });
        } else {
          pendingFraction.current = f;
        }
      } else {
        // Chapter change remounts the ScrollView (key={chIdx}); the pending
        // fraction is applied from onContentSizeChange.
        pendingFraction.current = f;
        metrics.current = { y: 0, viewH: metrics.current.viewH, contentH: 0 };
        setChIdx(clamped);
      }
    },
    [chs.length, chIdx]
  );

  const jumpToOffset = useCallback(
    (offset: number) => {
      const pos = positionFromOffset(offset, positionChapters, charCount);
      const target = chs[pos.chapterIndex];
      const f = target && target.char_count > 0 ? pos.chapterCharOffset / target.char_count : 0;
      jumpToChapter(pos.chapterIndex, f);
    },
    [positionChapters, charCount, chs, jumpToChapter]
  );

  const onSearchResult = useCallback(
    (r: SearchResult) => {
      const target = chs[r.chapterIndex];
      const f =
        target && target.char_count > 0 ? r.chapterOffset / target.char_count : 0;
      jumpToChapter(r.chapterIndex, f);
      setOverlay('none');
    },
    [chs, jumpToChapter]
  );

  // --- Bookmarks -----------------------------------------------------------------
  const addBookmark = useCallback(async () => {
    if (!doc || !ch || charCount <= 0) return;
    const pos = currentPosition(frac);
    if (!pos) return;
    const local = pos.chapterCharOffset;
    const snippet = ch.text.slice(Math.max(0, local - 40), local + 60).replace(/\s+/g, ' ').trim();
    await bookmarksRepo.create({
      id: '',
      document_id: doc.id,
      char_offset: pos.charOffset,
      chapter_index: pos.chapterIndex,
      chapter_char_offset: pos.chapterCharOffset,
      label: null,
      snippet: snippet || null,
    });
    setBms(await bookmarksRepo.list(doc.id));
    toast('Bookmark added');
  }, [doc, ch, charCount, frac, currentPosition, toast]);

  const deleteBookmark = useCallback(
    async (bid: string) => {
      await bookmarksRepo.softDelete(bid).catch(() => {});
      if (doc) setBms(await bookmarksRepo.list(doc.id).catch(() => []));
    },
    [doc]
  );

  const deleteHighlight = useCallback(async (hid: string) => {
    await highlightsRepo.softDelete(hid).catch(() => {});
    if (doc) setHls(await highlightsRepo.list(doc.id).catch(() => []));
  }, [doc]);

  // --- Display popup ---------------------------------------------------------------
  const applyStyle = useCallback(
    (patch: Partial<ReadingStyle>) => {
      if (scope === 'book' && id) {
        setJson(bookKey, { ...(bookOverride ?? {}), ...patch });
      } else {
        const current =
          normalizeStylePatch(
            getJson<Partial<ReadingStyle>>(SettingKeys.readerStyle)
          ) ?? DEFAULT_READING_STYLE;
        setJson(SettingKeys.readerStyle, { ...current, ...patch });
      }
    },
    [scope, id, bookKey, bookOverride, getJson, setJson]
  );

  const resetBook = useCallback(async () => {
    if (id) await remove(bookKey);
  }, [id, bookKey, remove]);

  const setBrightness = useCallback(
    (v: number) => {
      void set(SettingKeys.deviceReaderBrightness, v);
      Brightness.setBrightnessAsync(v / 100).catch(() => {});
    },
    [set]
  );

  // Apply the stored app brightness on mount; restore the previous value on exit.
  useEffect(() => {
    let prev = 1;
    let cancelled = false;
    Brightness.getBrightnessAsync()
      .then((b) => {
        prev = b;
        if (!cancelled) return Brightness.setBrightnessAsync(brightnessSetting / 100);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      Brightness.setBrightnessAsync(prev).catch(() => {});
    };
    // Only re-apply when the stored preference changes while mounted.
  }, [brightnessSetting]);

  // --- Search history ---------------------------------------------------------------
  const addHistory = useCallback(
    (q: string) => {
      const next = [q, ...searchHistory.filter((h) => h !== q)].slice(0, 10);
      void set(SettingKeys.deviceSearchHistory, next);
    },
    [searchHistory, set]
  );
  const clearHistory = useCallback(() => {
    void set(SettingKeys.deviceSearchHistory, []);
  }, [set]);

  // --- Progress label ---------------------------------------------------------------
  const label = useMemo(() => {
    if (!doc || charCount <= 0 || !ch) return '';
    const pos = currentPosition(frac);
    if (!pos) return '';
    if (percentageMode === 'chapter' && chs.length > 1 && ch.char_count > 0) {
      const chPct = Math.round((pos.chapterCharOffset / ch.char_count) * 100);
      return `Ch. ${chIdx + 1} of ${chs.length} · ${chPct}%`;
    }
    return `${Math.round(pos.percent * 100)}% of book`;
  }, [doc, charCount, ch, chs.length, chIdx, percentageMode, frac, currentPosition]);

  // Ask-once progress display prompt (plan 5.8): multi-chapter docs only.
  const pmPrompt =
    !!doc && doc.chapter_count > 1 && !has(SettingKeys.readerPercentageMode) && !pmDismissed;

  const fontFamily = readingFontFamily(style.fam);
  const fontSize = BASE_FONT_SIZE * (style.size / 100);
  const marginH = (winWidth * style.mar) / 100;

  const paragraphs = useMemo(() => (ch ? ch.text.split('\n') : []), [ch]);

  return (
    <Screen showNav={false}>
      <View className="flex-1" style={{ backgroundColor: style.bg }}>
        <AppBar
          title={doc?.title ?? 'Reader'}
          leading="back"
          actions={[
            {
              icon: 'search',
              label: 'Search in book',
              onPress: () => setOverlay('search'),
            },
          ]}
          customAction={
            <View className="flex-row items-center">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Display options"
                onPress={() => setOverlay('display')}
                className="px-2 py-1">
                <Text className="font-ui text-[17px] font-semibold" style={{ color: style.tx }}>
                  Aa
                </Text>
              </Pressable>
              <IconButton
                icon="ellipsis-vertical"
                label="More"
                onPress={() => setOverlay((o) => (o === 'menu' ? 'none' : 'menu'))}
              />
            </View>
          }
        />

        {/* Overflow menu (prototype `.menu`) */}
        {overlay === 'menu' && (
          <>
            <Pressable
              className="absolute inset-0 z-10"
              onPress={() => setOverlay('none')}
            />
            <View className="absolute right-3 z-20 bg-surface-2 rounded-lg py-1.5 w-[62%] max-w-[260px]">
              {(
                [
                  ['bookmark', 'Add bookmark', addBookmark],
                  ['list', 'Contents', () => setOverlay('panel')],
                  ['settings-outline', 'Settings', () => router.push('/settings-reader' as never)],
                ] as const
              ).map(([icon, label, fn]) => (
                <Pressable
                  key={label}
                  onPress={() => {
                    setOverlay('none');
                    void fn();
                  }}
                  className="flex-row items-center gap-3 px-5 py-3.5">
                  <Icon name={icon} size={18} tone="default" />
                  <Text className="font-ui text-tx text-[15px]">{label}</Text>
                </Pressable>
              ))}
            </View>
          </>
        )}

        {loadError ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-ui text-mu text-center">{loadError}</Text>
          </View>
        ) : chs.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-ui text-mu text-center">No readable text found.</Text>
          </View>
        ) : !ch ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-ui text-mu text-center">Loading…</Text>
          </View>
        ) : (
          <>
            <ScrollView
              key={chIdx}
              ref={scrollRef}
              className="flex-1"
              contentContainerStyle={{
                paddingHorizontal: marginH,
                paddingTop: 8,
                paddingBottom: 24,
              }}
              onScroll={onScroll}
              scrollEventThrottle={100}
              onLayout={onLayout}
              onContentSizeChange={onContentSize}>
              {/* Book cover landing page (if book has cover art and on chapter 0) */}
              {chIdx === 0 && doc?.cover_uri ? (
                <View
                  style={{
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingTop: 16,
                    paddingBottom: 28,
                  }}>
                  <View
                    style={{
                      width: '100%',
                      maxWidth: 420,
                      height: Math.min(winHeight * 0.70, 560),
                      borderRadius: 12,
                      overflow: 'hidden',
                      shadowColor: '#000',
                      shadowOffset: { width: 0, height: 8 },
                      shadowOpacity: 0.45,
                      shadowRadius: 14,
                      elevation: 8,
                      backgroundColor: 'transparent',
                    }}>
                    <Image
                      source={{ uri: doc.cover_uri }}
                      style={{
                        width: '100%',
                        height: '100%',
                        borderRadius: 12,
                      }}
                      contentFit="contain"
                      cachePolicy="memory-disk"
                    />
                  </View>

                  <View style={{ alignItems: 'center', marginTop: 22, paddingHorizontal: 16 }}>
                    <Text
                      style={{
                        color: style.tx,
                        fontFamily,
                        fontSize: Math.round(fontSize * 1.4),
                        fontWeight: '700',
                        textAlign: 'center',
                        lineHeight: Math.round(fontSize * 1.8),
                      }}>
                      {doc.title}
                    </Text>
                    {doc.author ? (
                      <Text
                        style={{
                          color: style.tx,
                          opacity: 0.7,
                          fontFamily,
                          fontSize: Math.round(fontSize * 0.95),
                          fontStyle: 'italic',
                          textAlign: 'center',
                          marginTop: 6,
                        }}>
                        {doc.author}
                      </Text>
                    ) : null}

                    <View
                      style={{
                        width: 50,
                        height: 2,
                        backgroundColor: style.tx,
                        opacity: 0.25,
                        marginVertical: 26,
                        borderRadius: 1,
                      }}
                    />
                  </View>
                </View>
              ) : null}

              {/* Chapter heading (prototype h2) */}
              {ch.title ? (
                <Text
                  className="mb-4"
                  style={{
                    color: style.tx,
                    fontFamily,
                    fontWeight: '600',
                    fontSize: fontSize * 1.4,
                    lineHeight: fontSize * 1.75,
                    borderBottomWidth: 2,
                    borderBottomColor: style.tx,
                    paddingBottom: 10,
                    marginTop: 16,
                    marginBottom: 20,
                    opacity: 0.9,
                  }}>
                  {ch.title}
                </Text>
              ) : null}
              {paragraphs.map((para, i) =>
                para.length === 0 ? (
                  <View key={i} className="h-3" />
                ) : (
                  <Text
                    key={i}
                    className="mb-4"
                    style={{
                      color: style.tx,
                      fontFamily,
                      fontWeight: String(style.wt) as '400',
                      fontSize,
                      lineHeight: Math.round(fontSize * style.lh),
                      textAlign: style.align === 'justify' ? 'justify' : 'left',
                    }}>
                    {para}
                  </Text>
                )
              )}
            </ScrollView>

            {/* Bottom bar: chapter title, percent, scrubber (prototype `.bot`) */}
            <View className="bg-surface px-5 pt-3.5 pb-4">
              <View className="flex-row justify-between items-center gap-3 mb-2">
                <Text
                  numberOfLines={1}
                  className="font-ui text-tx text-[15px] font-semibold flex-1">
                  {ch.title ?? `Chapter ${chIdx + 1}`}
                </Text>
                <Text className="font-ui text-tx text-[15px] font-semibold">
                  {Math.round(frac * 100)}%
                </Text>
              </View>
              <Slider
                style={{ width: '100%', height: 28 }}
                minimumValue={0}
                maximumValue={100}
                value={Math.round(frac * 100)}
                onValueChange={(v) => {
                  const f = v / 100;
                  const m = metrics.current;
                  const scrollable = m.contentH - m.viewH;
                  if (scrollable > 0) {
                    scrubbing.current = true;
                    scrollRef.current?.scrollTo({ y: f * scrollable, animated: false });
                    scrubbing.current = false;
                  }
                  setFrac(f);
                }}
                onSlidingComplete={(v) => scheduleSave(v / 100)}
                minimumTrackTintColor="rgb(var(--ac))"
                maximumTrackTintColor="rgb(var(--sf2))"
                thumbTintColor="rgb(var(--ac))"
              />
              <Text className="font-ui text-mu text-[12px] text-center mt-0.5" numberOfLines={1}>
                {label}
                {hasOverride ? ' · custom style' : ''}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* Overflow panel: contents / annotations / bookmarks */}
      <ContentsPanel
        visible={overlay === 'panel'}
        onClose={() => setOverlay('none')}
        chapters={chs}
        currentIndex={chIdx}
        bookmarks={bms}
        highlights={hls}
        onJumpChapter={jumpToChapter}
        onJumpOffset={jumpToOffset}
        onDeleteBookmark={deleteBookmark}
        onDeleteHighlight={deleteHighlight}
      />

      {/* Aa display popup (flow, brightness, theme, size, align, margin) */}
      <DisplayPopup
        visible={overlay === 'display'}
        onClose={() => setOverlay('none')}
        style={scope === 'book' ? style : defaultStyle}
        scope={scope}
        onScopeChange={setScope}
        hasOverride={hasOverride}
        onResetBook={resetBook}
        brightness={brightnessSetting}
        onBrightness={setBrightness}
        onPatch={applyStyle}
      />

      {/* In-book search with history */}
      <SearchOverlay
        visible={overlay === 'search'}
        onClose={() => setOverlay('none')}
        chapters={chs}
        history={searchHistory}
        onAddHistory={addHistory}
        onClearHistory={clearHistory}
        onResult={onSearchResult}
      />

      {/* Ask-once: progress display mode (plan 5.8) */}
      <Modal visible={pmPrompt} transparent animationType="fade" onRequestClose={() => setPmDismissed(true)}>
        <View className="flex-1 items-center justify-center bg-black/60 px-6">
          <View className="bg-surface rounded-[20px] p-5 w-full max-w-[340px]">
            <Text className="font-ui text-tx text-lg font-semibold">How should reading progress be shown?</Text>
            <Text className="font-ui text-mu mt-2">
              Whole book, or the current chapter. You can change this later in Settings → Reader →
              Progress display.
            </Text>
            <View className="flex-row justify-end mt-4 gap-2">
              <Pressable className="px-4 py-2 rounded-full" onPress={() => { setPmDismissed(true); void set(SettingKeys.readerPercentageMode, 'chapter'); }}>
                <Text className="font-ui text-accent font-semibold">Current chapter</Text>
              </Pressable>
              <Pressable
                className="px-4 py-2 rounded-full"
                style={{ backgroundColor: 'rgb(var(--ac))' }}
                onPress={() => { setPmDismissed(true); void set(SettingKeys.readerPercentageMode, 'book'); }}>
                <Text className="font-ui text-bg font-semibold">Whole book</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
