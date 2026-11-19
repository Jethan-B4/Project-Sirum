import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { useKeepAwake } from 'expo-keep-awake';

import { AppBar, Screen } from '@/components/chrome/app-bar';
import { Chip, SegmentedControl } from '@/components/ui/controls';
import { BottomSheet } from '@/components/ui/sheet';
import { chapters as chaptersRepo } from '@/db/repositories/chapters';
import { documents } from '@/db/repositories/documents';
import { progress as progressRepo } from '@/db/repositories/progress';
import { useSettings } from '@/features/settings/SettingsProvider';
import {
  DEFAULT_READING_STYLE,
  readerBookKey,
  SettingKeys,
  type ReadingStyle,
} from '@/lib/settingsKeys';
import { positionFromOffset } from '@/text/position';
import {
  ReadingStyleEditor,
  readingFontFamily,
} from './ReadingStyleEditor';
import type { ChapterRow } from '@/db/repositories/chapters';
import type { DocumentRow } from '@/db/repositories/documents';

interface LoadedChapter extends ChapterRow {
  text: string;
}

export default function ReaderScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { get, getJson, setJson, has, set, remove } = useSettings();
  useKeepAwake();

  const percentageMode = get(SettingKeys.readerPercentageMode);

  const [doc, setDoc] = useState<DocumentRow | null>(null);
  const [chs, setChs] = useState<LoadedChapter[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [scope, setScope] = useState<'all' | 'book'>('all');
  const [pmDismissed, setPmDismissed] = useState(false);

  // Reading style: synced default + optional per-book override (changed fields only).
  const defaultStyle = useMemo<ReadingStyle>(
    () => ({
      ...DEFAULT_READING_STYLE,
      ...(getJson<Partial<ReadingStyle>>(SettingKeys.readerStyle) ?? {}),
    }),
    [getJson]
  );
  const bookKey = id ? readerBookKey(id) : '';
  const bookOverride = useMemo(
    () => (id ? getJson<Partial<ReadingStyle>>(bookKey) : undefined),
    [getJson, id, bookKey]
  );
  const hasOverride = !!bookOverride && Object.keys(bookOverride).length > 0;
  const style: ReadingStyle = { ...defaultStyle, ...(bookOverride ?? {}) };

  const scrollRef = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const metrics = useRef({ y: 0, viewH: 0, contentH: 0 });
  const restored = useRef(false);
  const pendingWrite = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frac, setFrac] = useState(0);

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
        const loaded: LoadedChapter[] = [];
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
        if (!cancelled) setChs(loaded);
      } catch (e) {
        if (!cancelled) setLoadError(e instanceof Error ? e.message : 'Failed to open book');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Ask-once progress display prompt (plan 5.8): multi-chapter docs only.
  const pmPrompt =
    !!doc && doc.chapter_count > 1 && !has(SettingKeys.readerPercentageMode) && !pmDismissed;

  // --- Progress persistence ---------------------------------------------------
  const charCount = doc?.char_count ?? 0;

  const saveProgress = useCallback(
    async (fraction: number) => {
      if (!doc || charCount <= 0) return;
      const charOffset = Math.round(Math.min(1, Math.max(0, fraction)) * charCount);
      // Build minimal Chapter[] shape for position math (text not needed for offsets).
      const posChapters = chs.map((c) => ({
        index: c.chapter_index,
        title: c.title ?? '',
        startOffset: c.start_offset,
        charCount: c.char_count,
        text: c.text,
      }));
      const pos = positionFromOffset(charOffset, posChapters, charCount);
      await progressRepo.upsert(doc.id, {
        charOffset: pos.charOffset,
        chapterIndex: pos.chapterIndex,
        chapterCharOffset: pos.chapterCharOffset,
        percent: pos.percent,
        snippet: pos.snippet,
      });
    },
    [doc, charCount, chs]
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
        if (scrollable > 0) saveProgress(m.y / scrollable).catch(() => {});
      }
    },
    [saveProgress]
  );

  const onScroll = useCallback(
    (e: { nativeEvent: { contentOffset: { y: number }; layoutMeasurement: { height: number }; contentSize: { height: number } } }) => {
      const { contentOffset, layoutMeasurement, contentSize } = e.nativeEvent;
      metrics.current = {
        y: contentOffset.y,
        viewH: layoutMeasurement.height,
        contentH: contentSize.height,
      };
      const scrollable = contentSize.height - layoutMeasurement.height;
      const f = scrollable > 0 ? contentOffset.y / scrollable : 0;
      setFrac(f);
      if (scrollable > 0 && restored.current) {
        scheduleSave(f);
      }
    },
    [scheduleSave]
  );

  // Restore the saved reading position once both layout metrics are known.
  const restorePosition = useCallback(() => {
    if (!doc || restored.current) return;
    const m = metrics.current;
    const scrollable = m.contentH - m.viewH;
    if (scrollable <= 0) return;
    progressRepo
      .get(doc.id)
      .then((p) => {
        // Mark restored even without a saved row so scrolling starts recording
        // progress (and so opening a book never counts as "movement").
        restored.current = true;
        if (p) scrollRef.current?.scrollTo({ y: p.percent * scrollable, animated: false });
      })
      .catch(() => {});
  }, [doc]);

  // --- Style editing -----------------------------------------------------------
  const applyStyle = useCallback(
    (patch: Partial<ReadingStyle>) => {
      if (scope === 'book' && id) {
        setJson(bookKey, { ...(bookOverride ?? {}), ...patch });
      } else {
        const current = getJson<Partial<ReadingStyle>>(SettingKeys.readerStyle) ?? DEFAULT_READING_STYLE;
        setJson(SettingKeys.readerStyle, { ...current, ...patch });
      }
    },
    [scope, id, bookKey, bookOverride, getJson, setJson]
  );

  const resetBook = useCallback(async () => {
    if (id) await remove(bookKey);
  }, [id, bookKey, remove]);

  // --- Progress label ------------------------------------------------------------
  const label = useMemo(() => {
    if (!doc || charCount <= 0) return '';
    const charOffset = Math.round(Math.min(1, Math.max(0, frac)) * charCount);
    if (percentageMode === 'chapter' && chs.length > 1) {
      const pos = positionFromOffset(
        charOffset,
        chs.map((c) => ({
          index: c.chapter_index,
          title: c.title ?? '',
          startOffset: c.start_offset,
          charCount: c.char_count,
          text: c.text,
        })),
        charCount
      );
      const ch = chs[pos.chapterIndex];
      const chPct = ch && ch.char_count > 0 ? Math.round((pos.chapterCharOffset / ch.char_count) * 100) : 0;
      return `Ch. ${pos.chapterIndex + 1} of ${chs.length} · ${chPct}%`;
    }
    return `${Math.round(frac * 100)}% of book`;
  }, [doc, charCount, chs, percentageMode, frac]);

  const fontFamily = readingFontFamily(style.fam);

  return (
    <Screen showNav={false}>
      <AppBar
        title={doc?.title ?? 'Reader'}
        leading="back"
        customAction={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Display options"
            onPress={() => setSheetOpen(true)}
            className="px-2 py-1">
            <Text className="font-ui text-tx text-[17px] font-semibold">Aa</Text>
          </Pressable>
        }
      />

      {loadError ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-ui text-mu text-center">{loadError}</Text>
        </View>
      ) : chs.length === 0 ? (
        <View className="flex-1 items-center justify-center px-8">
          <Text className="font-ui text-mu text-center">No readable text found.</Text>
        </View>
      ) : (
        <>
          <ScrollView
            ref={scrollRef}
            className="flex-1"
            contentContainerStyle={{ paddingHorizontal: style.mar, paddingVertical: 16 }}
            onScroll={onScroll}
            scrollEventThrottle={100}
            onLayout={(e) => {
              metrics.current.viewH = e.nativeEvent.layout.height;
              restorePosition();
            }}
            onContentSizeChange={(_w, h) => {
              metrics.current.contentH = h;
              restorePosition();
            }}>
            <View style={{ backgroundColor: style.bg, borderRadius: 12, padding: 16 }}>
              {chs.map((ch) => (
                <View key={ch.chapter_index} className="mb-4">
                  {chs.length > 1 && ch.title ? (
                    <Text
                      className="mb-2"
                      style={{
                        color: style.tx,
                        fontFamily,
                        fontWeight: '700',
                        fontSize: style.size * 1.15,
                      }}>
                      {ch.title}
                    </Text>
                  ) : null}
                  {ch.text.split('\n').map((para, i) => (
                    <Text
                      key={i}
                      className="mb-3"
                      style={{
                        color: style.tx,
                        fontFamily,
                        fontWeight: String(style.wt) as '400',
                        fontSize: style.size,
                        lineHeight: Math.round(style.size * style.lh),
                        textAlign: 'left',
                      }}>
                      {para}
                    </Text>
                  ))}
                </View>
              ))}
            </View>
          </ScrollView>
          <View className="bg-surface px-4 py-3 items-center">
            <Text className="font-ui text-mu text-[13px]">
              {label}
              {hasOverride ? ' · custom style' : ''}
            </Text>
          </View>
        </>
      )}

      {/* Aa display sheet */}
      <BottomSheet visible={sheetOpen} onClose={() => setSheetOpen(false)} title="Reading display">
        <View className="mb-2">
          <SegmentedControl
            options={[
              ['all', 'All books'],
              ['book', 'This book only'],
            ]}
            value={scope}
            onChange={setScope}
          />
        </View>
        {scope === 'book' ? (
          <>
            <Text className="font-ui text-mu text-[13px] mb-2">
              {hasOverride ? 'This book has its own style.' : 'Changes apply to this book only.'}
            </Text>
            {hasOverride && (
              <Chip label="Reset this book" onPress={resetBook} />
            )}
          </>
        ) : (
          <Text className="font-ui text-mu text-[13px] mb-2">Changes become the default for all books.</Text>
        )}
        <ReadingStyleEditor
          value={scope === 'book' ? style : defaultStyle}
          onChange={applyStyle}
        />
        <View className="items-end mt-2">
          <Chip label="Done" selected onPress={() => setSheetOpen(false)} />
        </View>
      </BottomSheet>

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
