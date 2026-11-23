import { Image } from 'expo-image';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, AppState, Modal, Pressable, Text, View, useWindowDimensions } from 'react-native';
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
import { chapterNavigation, readSupplement } from '@/formats/epub/navigationCache';
import type { ChapterNavigation } from '@/formats/types';
import { plainLinks, resolveBookLink, linksInRange } from '@/text/links';
import { contrastText, linkColor } from '@/lib/color';
import { chunkChapter } from '@/text/chunk';
import { useAppTheme } from '@/theme/ThemeProvider';
import { ThemePalettes } from '@/theme/palette';
import { bookPercent } from '@/text/position';
import { ChunkedChapter } from './ChunkedChapter';
import type { ProgressInput } from '@/db/repositories/progress';
import { ContentsPanel } from './ContentsPanel';
import { DisplayPopup } from './DisplayPopup';
import { readingFontFamily, BASE_FONT_SIZE } from './ReadingStyleEditor';
import { resumePosition } from './resume';
import { SearchOverlay } from './SearchOverlay';
import type { ReaderChapter, SearchResult } from './types';
import type { BookmarkRow } from '@/db/repositories/bookmarks';
import type { HighlightRow } from '@/db/repositories/highlights';
import type { DocumentRow } from '@/db/repositories/documents';

type Overlay = 'none' | 'menu' | 'panel' | 'display' | 'search';

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <BookReader key={id} id={id} />;
}

function BookReader({ id }: { id: string }) {
  const router = useRouter();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const { get, getJson, setJson, has, set, remove } = useSettings();
  const { toast } = useChrome();
  const { accent, name: themeName } = useAppTheme();
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

  const [loaded, setLoaded] = useState<{ index: number; text: string } | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const activeText = loaded?.index === chIdx ? loaded.text : null;
  const chunks = useMemo(() => chunkChapter(chIdx, activeText ?? '', 0), [chIdx, activeText]);
  const [chapterNav, setChapterNav] = useState<{ index: number; data: ChapterNavigation } | null>(null);
  const nav = chapterNav?.index === chIdx ? chapterNav.data : null;
  const plain = useMemo(() => plainLinks(activeText ?? ''), [activeText]);
  const links = useMemo(() => {
    if (!nav?.links.length) return plain;
    const extra = plain.filter((link) => !linksInRange(nav.links, link.start, link.end).length);
    return extra.length ? [...nav.links, ...extra].sort((a, b) => a.start - b.start) : nav.links;
  }, [nav, plain]);
  const sources = useMemo(() => chs.map((row) => row.source_href), [chs]);
  const ch = chs[chIdx];
  const charCount = doc?.char_count ?? 0;
  const pending = useRef<ProgressInput | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastOffset = useRef(0);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const value = pending.current;
    if (value) {
      pending.current = null;
      void progressRepo.upsert(id, value).catch(() => toast('Reading position could not be saved'));
    }
  }, [id, toast]);

  useFocusEffect(useCallback(() => flush, [flush]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flush();
    });
    return () => { subscription.remove(); flush(); };
  }, [flush]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [d, rows, saved] = await Promise.all([
        documents.getById(id), chaptersRepo.list(id), progressRepo.get(id),
      ]);
      if (cancelled) return;
      if (!d) throw new Error('Book could not be found.');
      const { row, index, offset } = resumePosition(rows, saved);
      lastOffset.current = (row?.start_offset ?? 0) + offset;
      setFrac(row?.char_count ? offset / row.char_count : 0);
      setChIdx(index);
      setChs(rows);
      setDoc(d);
      setReady(true);
      const [bm, hl] = await Promise.all([bookmarksRepo.list(id).catch(() => []), highlightsRepo.list(id).catch(() => [])]);
      if (!cancelled) { setBms(bm); setHls(hl); }
    })().catch((e) => { if (!cancelled) setLoadError(String(e)); });
    return () => { cancelled = true; };
  }, [id]);

  const readChapter = useCallback((index: number) => {
    const file = String(index).padStart(4, '0') + '.txt';
    return FileSystem.readAsStringAsync(doc?.text_dir + '/' + file);
  }, [doc?.text_dir]);

  useEffect(() => {
    if (!ch) return;
    let cancelled = false;
    readChapter(ch.chapter_index).then((text) => {
      if (!cancelled) setLoaded({ index: chIdx, text });
    }).catch(() => {
      if (!cancelled) setLoadError('This chapter could not be read from device storage.');
    });
    return () => { cancelled = true; };
  }, [ch, chIdx, readChapter]);

  useEffect(() => {
    if (!ch || doc?.format !== 'epub' || !doc.local_uri || !doc.text_dir) return;
    let active = true;
    chapterNavigation(doc.local_uri, doc.text_dir, chs, ch.chapter_index)
      .then((data) => { if (active) setChapterNav({ index: chIdx, data }); })
      .catch(() => { if (active) toast('Embedded links could not be loaded for this chapter'); });
    return () => { active = false; };
  }, [ch, chIdx, doc, chs, toast]);

  const readForSearch = useCallback((index: number) =>
    loaded?.index === index ? Promise.resolve(loaded.text) : readChapter(index),
  [loaded, readChapter]);

  const recordPosition = useCallback((index: number, offset: number) => {
    const row = chs[index];
    const global = row.start_offset + offset;
    const fraction = row.char_count ? offset / row.char_count : 0;
    setFrac((previous) => {
      if (index !== chIdx || Math.round(previous * 100) !== Math.round(fraction * 100)) return fraction;
      const previousGlobal = row.start_offset + previous * row.char_count;
      return Math.round(bookPercent(previousGlobal, charCount) * 100) === Math.round(bookPercent(global, charCount) * 100)
        ? previous : fraction;
    });
    if (global === lastOffset.current && index === chIdx) return;
    lastOffset.current = global;
    pending.current = {
      charOffset: global, chapterIndex: index, chapterCharOffset: offset,
      percent: bookPercent(global, charCount),
      snippet: loaded?.index === index ? loaded.text.slice(offset, offset + 100) : undefined,
    };
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 750);
  }, [chs, chIdx, loaded, charCount, flush]);

  const jumpToChapter = useCallback((index: number, fraction = 0) => {
    const row = chs[index];
    if (!row) return;
    const offset = Math.round(row.char_count * Math.max(0, Math.min(1, fraction)));
    recordPosition(index, offset);
    setLoadError(null);
    setChIdx(index);
    setNavigationRevision((revision) => revision + 1);
  }, [chs, recordPosition]);

  const [supplement, setSupplement] = useState<{
    section: Awaited<ReturnType<typeof readSupplement>>;
    path: string; offset: number; revision: number;
  } | null>(null);
  const supplementChunks = useMemo(() => chunkChapter(0, supplement?.section.text ?? '', 0), [supplement]);
  const followLink = useCallback((href: string) => {
    const source = supplement ? '/' + supplement.path.split('/').map(encodeURIComponent).join('/') : ch?.source_href ?? '';
    const target = resolveBookLink(href, source, sources, nav?.packageDir);
    if (target.kind === 'missing') {
      Alert.alert('Link unavailable', target.address);
      return;
    }
    const proceed = async () => {
      if (target.kind === 'external') {
        await Linking.openURL(target.address);
        return;
      }
      if (target.kind === 'supplement') {
        if (!doc?.local_uri) throw Error();
        const section = supplement?.path === target.path ? supplement.section : await readSupplement(doc.local_uri, target.path);
        const offset = target.fragment ? section.navigation.anchors.find(([id]) => id === target.fragment)?.[1] : 0;
        if (offset == null) throw Error();
        setSupplement((previous) => ({ section, path: target.path, offset, revision: (previous?.revision ?? 0) + 1 }));
        return;
      }
      let offset = 0;
      if (target.fragment) {
        if (!doc?.local_uri || !doc.text_dir) throw Error();
        const data = target.index === chIdx && nav ? nav :
          await chapterNavigation(doc.local_uri, doc.text_dir, chs, chs[target.index].chapter_index);
        const point = data.anchors.find(([id]) => id === target.fragment);
        if (!point) throw Error();
        offset = point[1];
      }
      setSupplement(null);
      jumpToChapter(target.index, offset / (chs[target.index].char_count || 1));
    };
    Alert.alert(target.kind === 'external' ? 'Open external address?' : 'Go to this passage?',
      target.address, [
        { text: 'Cancel', style: 'cancel' },
        { text: target.kind === 'external' ? 'Open' : 'Go to passage',
          onPress: () => { void proceed().catch(() => toast('Link destination is unavailable')); } },
      ], { cancelable: true });
  }, [ch, chIdx, sources, nav, doc, chs, jumpToChapter, toast, supplement]);

  const jumpToOffset = (offset: number) => {
    const index = Math.max(0, chs.findLastIndex((row) => row.start_offset <= offset));
    const row = chs[index];
    if (row) jumpToChapter(index, row.char_count ? (offset - row.start_offset) / row.char_count : 0);
  };

  const onSearchResult = (result: SearchResult) => {
    const row = chs[result.chapterIndex];
    jumpToChapter(result.chapterIndex, result.chapterOffset / (row.char_count || 1));
    setOverlay('none');
  };

  // --- Bookmarks -----------------------------------------------------------------
  const addBookmark = useCallback(async () => {
    if (!doc || !ch || charCount <= 0) return;
    if (activeText === null) return;
    const local = Math.max(0, Math.min(ch.char_count, lastOffset.current - ch.start_offset));
    const snippet = activeText.slice(Math.max(0, local - 40), local + 60).replace(/\s+/g, ' ').trim();
    await bookmarksRepo.create({
      id: '',
      document_id: doc.id,
      char_offset: ch.start_offset + local,
      chapter_index: chIdx,
      chapter_char_offset: local,
      label: null,
      snippet: snippet || null,
    });
    setBms(await bookmarksRepo.list(doc.id));
    toast('Bookmark added');
  }, [doc, ch, charCount, chIdx, activeText, toast]);

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
    const local = Math.round(frac * ch.char_count);
    if (percentageMode === 'chapter' && chs.length > 1 && ch.char_count > 0) {
      const chPct = Math.round((local / ch.char_count) * 100);
      return `Ch. ${chIdx + 1} of ${chs.length} · ${chPct}%`;
    }
    return `${Math.round(bookPercent(ch.start_offset + local, charCount) * 100)}% of book`;
  }, [doc, charCount, ch, chs.length, chIdx, percentageMode, frac]);

  // Ask-once progress display prompt (plan 5.8): multi-chapter docs only.
  const pmPrompt =
    !!doc && doc.chapter_count > 1 && !has(SettingKeys.readerPercentageMode) && !pmDismissed;

  const fontFamily = readingFontFamily(style.fam);
  const fontSize = BASE_FONT_SIZE * (style.size / 100);
  const marginH = (winWidth * style.mar) / 100;



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
                  ['bookmark', 'Add bookmark'],
                  ['list', 'Contents'],
                  ['settings-outline', 'Settings'],
                ] as const
              ).map(([icon, label]) => (
                <Pressable
                  key={label}
                  onPress={() => {
                    setOverlay(icon === 'list' ? 'panel' : 'none');
                    if (icon === 'bookmark') void addBookmark();
                    if (icon === 'settings-outline') router.push('/settings-reader' as never);
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
        ) : ready && chs.length === 0 ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-ui text-mu text-center">No readable text found.</Text>
          </View>
        ) : !ch || activeText === null ? (
          <View className="flex-1 items-center justify-center px-8">
            <Text className="font-ui text-mu text-center">Loading…</Text>
          </View>
        ) : (
          <>
            <ChunkedChapter
              key={[chIdx, navigationRevision, winWidth, style.fam, style.size, style.lh,
                style.wt, style.mar, style.align].join('/')}
              chunks={chunks}
              links={links}
              linkColor={linkColor(style.bg)}
              onLink={followLink}
              length={activeText.length}
              initialOffset={() => Math.max(0, Math.min(ch.char_count, lastOffset.current - ch.start_offset))}
              margin={marginH}
              textStyle={{ color: style.tx, fontFamily, fontWeight: String(style.wt) as '400',
                fontSize, lineHeight: Math.round(fontSize * style.lh), textAlign: style.align }}
              onMove={(offset) => recordPosition(chIdx, offset)}
              footer={chIdx + 1 < chs.length && (
                <Pressable accessibilityRole="button" onPress={() => jumpToChapter(chIdx + 1)} className="py-5">
                  <Text style={{ color: style.tx }}>Next chapter</Text>
                </Pressable>
              )}>
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
            </ChunkedChapter>

            {/* Bottom bar: chapter title, percent, scrubber (prototype `.bot`) */}
            <View className={winHeight < 480 ? "bg-surface px-4 py-1" : "bg-surface px-5 pt-3.5 pb-4"}>
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
                onValueChange={(value) => setFrac(value / 100)}
                onSlidingComplete={(value) => jumpToChapter(chIdx, value / 100)}
                minimumTrackTintColor={accent.hex}
                maximumTrackTintColor={'rgb(' + ThemePalettes[themeName].sf2.replace(/ /g, ',') + ')'}
                thumbTintColor={accent.hex}
              />
              <Text className="font-ui text-mu text-[12px] text-center mt-0.5" numberOfLines={1}>
                {label}
                {hasOverride ? ' · custom style' : ''}
              </Text>
            </View>
          </>
        )}
      </View>

      {supplement && (
        <Modal
          supportedOrientations={['portrait', 'landscape']} visible animationType="fade" onRequestClose={() => setSupplement(null)}>
          <Screen showNav={false}>
            <View style={{ flex: 1, backgroundColor: style.bg }}>
              <View className="flex-row items-center gap-2 px-3 py-2">
                <Text numberOfLines={1} className="flex-1 font-ui font-semibold" style={{ color: style.tx }}>
                  {supplement.section.firstHeading ?? supplement.path}
                </Text>
                <IconButton icon="close" label="Return to reading" tone={style.tx} onPress={() => setSupplement(null)} />
              </View>
              <ChunkedChapter key={supplement.revision} chunks={supplementChunks}
                length={supplement.section.text.length} links={supplement.section.navigation.links}
                linkColor={linkColor(style.bg)} onLink={followLink} initialOffset={supplement.offset}
                margin={marginH} textStyle={{ color: style.tx, fontFamily, fontSize, lineHeight: Math.round(fontSize * style.lh) }}
                onMove={() => {}} footer={null}>{null}</ChunkedChapter>
            </View>
          </Screen>
        </Modal>
      )}

      {/* Overflow panel: contents / annotations / bookmarks */}
      <ContentsPanel
        visible={overlay === 'panel'}
        onClose={() => setOverlay('none')}
        chapters={chs}
        currentIndex={chIdx}
        bookmarks={bms}
        highlights={hls}
        readChapter={readForSearch}
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
        readChapter={readForSearch}
        history={searchHistory}
        onAddHistory={addHistory}
        onClearHistory={clearHistory}
        onResult={onSearchResult}
      />

      {/* Ask-once: progress display mode (plan 5.8) */}
      <Modal
        supportedOrientations={['portrait', 'landscape']} visible={pmPrompt} transparent animationType="fade" onRequestClose={() => setPmDismissed(true)}>
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
                style={{ backgroundColor: accent.hex }}
                onPress={() => { setPmDismissed(true); void set(SettingKeys.readerPercentageMode, 'book'); }}>
                <Text className="font-ui font-semibold" style={{ color: contrastText(accent.hex) }}>Whole book</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
