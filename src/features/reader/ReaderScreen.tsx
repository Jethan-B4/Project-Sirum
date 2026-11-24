import { ReaderMotion, ReaderOverlay } from './ReaderOverlay';
import { ReaderCover } from './ReaderCover';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, Alert, Animated, Easing, Linking, AppState, Pressable, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
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
import { ReaderOptionsPopup } from './ReaderOptionsPopup';
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
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <BookReader key={id} id={id} />
    </GestureHandlerRootView>
  );
}

function BookReader({ id }: { id: string }) {
  const router = useRouter();
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [viewportHeight, setViewportHeight] = useState(winHeight);
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
  const [toolbarHeight, setToolbarHeight] = useState(54);
  const [progressHeight, setProgressHeight] = useState(54);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  useEffect(() => {
    let pending = true;
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => {
      pending = false;
      setReducedMotion(value);
    });
    void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (pending) setReducedMotion(value); });
    return () => { pending = false; subscription.remove(); };
  }, []);
  const [screenReader, setScreenReader] = useState(false);
  useEffect(() => {
    let waitingForInitialValue = true;
    const subscription = AccessibilityInfo.addEventListener('screenReaderChanged', (enabled) => {
      waitingForInitialValue = false;
      setScreenReader(enabled);
    });
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (waitingForInitialValue) setScreenReader(enabled);
    });
    return () => { waitingForInitialValue = false; subscription.remove(); };
  }, []);
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

  const [loaded, setLoaded] = useState<{ index: number; text: string; nav: ChapterNavigation | null } | null>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  const [ready, setReady] = useState(false);
  const activeText = loaded?.index === chIdx ? loaded.text : null;
  const nav = loaded?.index === chIdx ? loaded.nav : null;
  const chunks = useMemo(() => chunkChapter(chIdx, activeText ?? '', 0, nav?.images, nav?.paragraphs), [chIdx, activeText, nav]);
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

  const loadChapter = useCallback(async (index: number) => {
    const storedIndex = chs[index].chapter_index;
    const [text, presentation] = await Promise.all([
      readChapter(storedIndex),
      doc?.format === 'epub' && doc.local_uri && doc.text_dir
        ? chapterNavigation(doc.local_uri, doc.text_dir, chs, storedIndex).catch(() => null) : null,
    ]);
    return { index, text, nav: presentation };
  }, [chs, doc, readChapter]);

  useEffect(() => {
    if (!ch || loaded?.index === chIdx) return;
    let cancelled = false;
    loadChapter(chIdx).then((page) => {
      if (!cancelled) setLoaded(page);
    }).catch(() => {
      if (!cancelled) setLoadError('This chapter could not be read from device storage.');
    });
    return () => { cancelled = true; };
  }, [ch, chIdx, loaded?.index, loadChapter]);

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

  const request = useRef(0);
  const [direction, setDirection] = useState(1);
  useEffect(() => () => { request.current++; }, []);
  const jumpToChapter = useCallback(async (index: number, fraction = 0) => {
    const row = chs[index];
    if (!row) return;
    const ticket = ++request.current;
    const offset = Math.round(row.char_count * Math.max(0, Math.min(1, fraction)));
    try {
      const page = loaded?.index === index ? loaded : await loadChapter(index);
      if (request.current !== ticket) return;
      setDirection(row.start_offset + offset < lastOffset.current || index < chIdx ? -1 : 1);
      setLoaded(page);
    } catch {
      if (request.current === ticket) toast('This chapter could not be opened');
      return;
    }
    recordPosition(index, offset);
    setControlsVisible(false);
    setLoadError(null);
    setChIdx(index);
    setNavigationRevision((revision) => revision + 1);
  }, [chs, chIdx, loaded, loadChapter, recordPosition, toast]);

  const [supplementVisible, setSupplementVisible] = useState(false);
  const [supplement, setSupplement] = useState<{
    section: Awaited<ReturnType<typeof readSupplement>>;
    path: string; offset: number; revision: number;
  } | null>(null);
  const supplementChunks = useMemo(() => chunkChapter(0, supplement?.section.text ?? '', 0,
    supplement?.section.navigation.images, supplement?.section.navigation.paragraphs), [supplement]);
  const followLink = useCallback((href: string) => {
    const source = supplementVisible && supplement ? '/' + supplement.path.split('/').map(encodeURIComponent).join('/') : ch?.source_href ?? '';
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
        if (!doc?.local_uri || !doc.text_dir) throw Error();
        const section = supplement?.path === target.path ? supplement.section : await readSupplement(doc.local_uri, target.path, doc.text_dir);
        const offset = target.fragment ? section.navigation.anchors.find(([id]) => id === target.fragment)?.[1] : 0;
        if (offset == null) throw Error();
        setSupplement((previous) => ({ section, path: target.path, offset, revision: (previous?.revision ?? 0) + 1 }));
        setSupplementVisible(true);
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
      setSupplementVisible(false);
      jumpToChapter(target.index, offset / (chs[target.index].char_count || 1));
    };
    Alert.alert(target.kind === 'external' ? 'Open external address?' : 'Go to this passage?',
      target.address, [
        { text: 'Cancel', style: 'cancel' },
        { text: target.kind === 'external' ? 'Open' : 'Go to passage',
          onPress: () => { void proceed().catch(() => toast('Link destination is unavailable')); } },
      ], { cancelable: true });
  }, [ch, chIdx, sources, nav, doc, chs, jumpToChapter, toast, supplement, supplementVisible]);

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
  const marginH = (winWidth * style.mar) / 100 + Math.max(insets.left, insets.right);
  const showControls = controlsVisible || screenReader || !!loadError;
  const embeddedCover = chIdx === 0 && nav?.images?.length === 1 && !activeText?.trim();
  const openingCover = chIdx === 0 && (embeddedCover || !!doc?.cover_uri);
  const transition = get(SettingKeys.readerTransition);
  const duration = reducedMotion || transition === 'none' ? 0
    : { fast: 130, normal: 220, slow: 360 }[get(SettingKeys.readerTransitionSpeed)];
  const [chromeMotion] = useState(() => new Animated.Value(0));
  const [pageMotion] = useState(() => new Animated.Value(1));
  const animatePage = useCallback(() => {
    pageMotion.stopAnimation();
    pageMotion.setValue(duration ? 0 : 1);
    if (duration) Animated.timing(pageMotion, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false }).start();
  }, [duration, pageMotion]);
  const lastRevision = useRef(0);
  useLayoutEffect(() => {
    if (lastRevision.current !== navigationRevision) animatePage();
    lastRevision.current = navigationRevision;
  }, [animatePage, navigationRevision]);
  useEffect(() => {
    const toValue = showControls ? 1 : 0;
    if (!duration) { chromeMotion.setValue(toValue); pageMotion.setValue(1); return; }
    const animation = Animated.timing(chromeMotion, { toValue, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false });
    animation.start();
    return () => animation.stop();
  }, [chromeMotion, pageMotion, duration, showControls]);
  const chromeStyle = (edge: number) => ({
    opacity: chromeMotion,
    transform: [{ translateY: chromeMotion.interpolate({ inputRange: [0, 1], outputRange: [transition === 'slide' ? edge : 0, 0] }) }],
  });

  return (
    <ReaderMotion.Provider value={{ duration, slide: transition === 'slide' }}>
      <View className="flex-1" style={{ backgroundColor: style.bg }} onLayout={e => setViewportHeight(e.nativeEvent.layout.height)}>
        <Animated.View className="absolute top-0 left-0 right-0 z-10 bg-surface border-b border-line"
          pointerEvents={showControls ? 'auto' : 'none'} accessibilityElementsHidden={!showControls}
          importantForAccessibility={showControls ? 'auto' : 'no-hide-descendants'}
          style={[chromeStyle(-12), { paddingTop: insets.top, paddingLeft: insets.left, paddingRight: insets.right }]} onLayout={(e) => setToolbarHeight(e.nativeEvent.layout.height)}>
          <AppBar compact
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
                  <Text className="font-ui text-tx text-[17px] font-semibold">
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
        </Animated.View>

        <ReaderOptionsPopup inline visible={overlay === 'menu'} onClose={() => setOverlay('none')} toolbarHeight={toolbarHeight}>
          <View className="py-1.5">
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
        </ReaderOptionsPopup>

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
            <Animated.View style={{ flex: 1, marginTop: openingCover ? 0 : insets.top, marginBottom: openingCover ? 0 : insets.bottom,
              opacity: pageMotion, transform: [{ translateX: pageMotion.interpolate({
              inputRange: [0, 1], outputRange: [transition === 'slide' ? direction * winWidth * 0.20 : 0, 0],
            }) }] }}>
              <ChunkedChapter
                key={[chIdx, navigationRevision, !!nav?.presentationVersion, winWidth, style.fam, style.size, style.lh,
                  style.wt, style.mar, style.align].join('/')}
                chunks={chunks}
                startPadding={openingCover ? 0 : screenReader ? Math.max(0, toolbarHeight - insets.top) + 4 : 4}
                endPadding={(screenReader ? progressHeight + 4 : insets.bottom + 6) - (openingCover ? 0 : insets.bottom)}
                coverHeight={embeddedCover ? viewportHeight : undefined}
                publisherStyles={nav?.styles} paragraphs={nav?.paragraphs} mediaDir={doc?.text_dir}
                links={links}
                linkColor={linkColor(style.bg)}
                onLink={followLink}
                length={activeText.length}
                initialOffset={() => Math.max(0, Math.min(ch.char_count, lastOffset.current - ch.start_offset))}
                margin={marginH}
                textStyle={{ color: style.tx, fontFamily, fontWeight: String(style.wt) as '400',
                  fontSize, lineHeight: Math.round(fontSize * style.lh), textAlign: style.align }}
                onMove={(offset) => recordPosition(chIdx, offset)}
                onToggleControls={() => setControlsVisible((visible) => !visible)}
                onScrollStart={() => setControlsVisible(false)}
                paged={!screenReader && (style.flow === 'paged' || (style.flow === 'auto' && winWidth >= 700))}
                onPageTurn={(step) => { setDirection(step); setControlsVisible(false); animatePage(); }}
                onChapterSwipe={chs.length > 1 && !screenReader ? (step, atEnd) => jumpToChapter(chIdx + step, atEnd ? 1 : 0) : undefined}
                footer={get(SettingKeys.readerNextButton) && chIdx + 1 < chs.length && (
                  <Pressable accessibilityRole="button" onPress={(event) => {
                    event.stopPropagation();
                    jumpToChapter(chIdx + 1);
                  }} accessibilityLabel={'Next chapter, ' + (chs[chIdx + 1].title ?? (chIdx + 2))}
                    style={({ pressed }) => ({ minHeight: 44, alignSelf: 'center', marginVertical: 8,
                      paddingHorizontal: 18, flexDirection: 'row', gap: 8, alignItems: 'center', borderRadius: 22,
                      backgroundColor: accent.hex, opacity: pressed ? 0.75 : 1 })}>
                    <Text style={{ color: contrastText(accent.hex), fontWeight: '600' }}>Next chapter</Text>
                    <Icon name="arrow-forward" size={16} tone={contrastText(accent.hex)} />
                  </Pressable>
                )}>
                {openingCover && !embeddedCover && doc?.cover_uri && (
                  <ReaderCover uri={doc.cover_uri} label={doc.title + ' cover'} height={viewportHeight} />
                )}
                {doc?.format !== 'epub' && ch.title && !activeText.startsWith(ch.title + '\n') && activeText !== ch.title && (
                  <Text accessibilityRole="header" style={{ color: style.tx, fontFamily, fontWeight: '600',
                    fontSize: fontSize * 1.3, marginBottom: 8, marginHorizontal: marginH }}>{ch.title}</Text>
                )}
              </ChunkedChapter>
            </Animated.View>

            {/* Bottom bar: chapter title, percent, scrubber (prototype `.bot`) */}
            <Animated.View className="absolute bottom-0 left-0 right-0 z-10 bg-surface border-t border-line"
              pointerEvents={showControls ? 'auto' : 'none'} accessibilityElementsHidden={!showControls}
              importantForAccessibility={showControls ? 'auto' : 'no-hide-descendants'}
              style={[chromeStyle(12), { paddingTop: 3, paddingBottom: insets.bottom, paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}
              onLayout={(e) => setProgressHeight(e.nativeEvent.layout.height)}>
              <View className="flex-row justify-between items-center gap-3">
                <Text
                  numberOfLines={1}
                  className="font-ui text-tx text-[15px] font-semibold flex-1">
                  {ch.title ?? `Chapter ${chIdx + 1}`}
                </Text>
                <Text className="font-ui text-tx text-[15px] font-semibold">
                  {label || Math.round(frac * 100) + '%'}
                </Text>
              </View>
              <Slider
                accessibilityLabel="Chapter position"
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
            </Animated.View>
          </>
        )}
      </View>

      {supplement && (
        <ReaderOverlay visible={supplementVisible} onClose={() => setSupplementVisible(false)}>
          <Screen showNav={false}>
            <View style={{ flex: 1, backgroundColor: style.bg }}>
              <View className="flex-row items-center gap-2 px-3 py-2">
                <Text numberOfLines={1} className="flex-1 font-ui font-semibold" style={{ color: style.tx }}>
                  {supplement.section.firstHeading ?? supplement.path}
                </Text>
                <IconButton icon="close" label="Return to reading" tone={style.tx} onPress={() => setSupplementVisible(false)} />
              </View>
              <ChunkedChapter key={supplement.revision} chunks={supplementChunks}
                publisherStyles={supplement.section.navigation.styles} paragraphs={supplement.section.navigation.paragraphs} mediaDir={doc?.text_dir}
                length={supplement.section.text.length} links={supplement.section.navigation.links}
                linkColor={linkColor(style.bg)} onLink={followLink} initialOffset={supplement.offset}
                margin={winWidth * style.mar / 100} textStyle={{ color: style.tx, fontFamily, fontSize, lineHeight: Math.round(fontSize * style.lh) }}
                onMove={() => {}} footer={null}>{null}</ChunkedChapter>
            </View>
          </Screen>
        </ReaderOverlay>
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
        toolbarHeight={Math.max(0, toolbarHeight - insets.top)}
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
      <ReaderOverlay visible={pmPrompt} onClose={() => setPmDismissed(true)}>
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
      </ReaderOverlay>
    </ReaderMotion.Provider>
  );
}
