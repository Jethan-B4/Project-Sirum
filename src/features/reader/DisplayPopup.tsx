import React, { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { ReaderOptionsPopup } from './ReaderOptionsPopup';
import { IconButton } from '@/components/ui/icon';
import { pressFeedback } from '@/components/ui/press-feedback';

import { Chip, ColorSwatches, SectionLabel, SegmentedControl, SliderRow } from '@/components/ui/controls';
import { useAppTheme } from '@/theme/ThemeProvider';
import { contrastText } from '@/lib/color';
import { SettingKeys, type ReadingStyle } from '@/lib/settingsKeys';
import { useSettings } from '@/features/settings/SettingsProvider';
import { BG_SWATCHES, LineHeightControl, ParagraphIndentControl, TX_SWATCHES } from './ReadingStyleEditor';

/** Prototype theme swatches: [background, text] pairs. */
const THEME_SWATCHES: readonly (readonly [string, string, string])[] = [
  ['#ffffff', '#1a1a1a', 'White'],
  ['#2b2b2e', '#e0e0e0', 'Dark gray'],
  ['#000000', '#e6e6e6', 'Black'],
  ['#f1e4c3', '#4a3a22', 'Sepia'],
];

/**
 * Display popup opened from the reader's "Aa" button (prototype `.disp`).
 * Writes only the current book's override. Defaults for all books live in Settings.
 */
export function DisplayPopup({
  visible,
  toolbarHeight,
  onClose,
  style,
  hasOverride,
  headingDetected,
  onResetBook,
  brightness,
  onBrightness,
  onPatch,
}: {
  visible: boolean;
  toolbarHeight: number;
  onClose: () => void;
  style: ReadingStyle;
  hasOverride: boolean;
  headingDetected: boolean;
  onResetBook: () => void;
  /** Device-local brightness, 20–100 (device.readerBrightness). */
  brightness: number;
  onBrightness: (v: number) => void;
  onPatch: (patch: Partial<ReadingStyle>) => void;
}) {
  const [tab, setTab] = useState<'text' | 'colors' | 'layout'>('text');
  const { accent, colors } = useAppTheme();
  const { get, set } = useSettings();

  return (
    <ReaderOptionsPopup visible={visible} onClose={onClose} toolbarHeight={toolbarHeight} wide>
      <View className="flex-row items-center px-4 py-1 border-b border-line">
        <Text className="flex-1 text-tx font-ui text-lg font-semibold">Reading display</Text>
        <IconButton icon="close" label="Close display settings" onPress={onClose} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
        {hasOverride && <Chip label="Reset this book" onPress={onResetBook} />}
        <View className="my-3">
          <SegmentedControl options={[['text', 'Text'], ['colors', 'Colors'], ['layout', 'Layout']]} value={tab} onChange={setTab} />
        </View>
        {tab === 'text' && <>
          <SliderRow label="Text size" value={style.size} display={style.size + '%'} min={60} max={200}
            step={10} onChange={(size) => onPatch({ size })} />
          <LineHeightControl value={style.lh} onChange={onPatch} />
          <ParagraphIndentControl style={style} onChange={onPatch} />
          {headingDetected && <>
            <SectionLabel>Chapter heading alignment</SectionLabel>
            <SegmentedControl options={[
              ['publisher', 'Publisher'],
              ['left', 'Left'],
              ['center', 'Center'],
              ['right', 'Right'],
            ]} value={style.headingAlign} onChange={(headingAlign) => onPatch({ headingAlign })} />
            <SectionLabel>Chapter heading underline</SectionLabel>
            <SegmentedControl options={[
              ['publisher', 'Publisher'],
              ['on', 'On'],
              ['off', 'Off'],
            ]} value={style.headingUnderline} onChange={(headingUnderline) => onPatch({ headingUnderline })} />
          </>}
          <SectionLabel>Alignment</SectionLabel>
          <SegmentedControl options={[['left', 'Left'], ['justify', 'Justify']]} value={style.align}
            onChange={(align) => onPatch({ align })} />
        </>}
        {tab === 'layout' && <>
          <SliderRow label="Side margins" value={style.mar} display={style.mar + '%'} min={0} max={10}
            step={1} onChange={(mar) => onPatch({ mar })} />
          <SectionLabel>Reading flow</SectionLabel>
          <SegmentedControl options={[['auto', 'Auto'], ['paged', 'Paged'], ['scrolled', 'Scrolled']]}
            value={style.flow} onChange={(flow) => onPatch({ flow })} />
          <SectionLabel>Progress bar (all books)</SectionLabel>
          <SegmentedControl options={[['book', 'Whole book'], ['chapter', 'Current chapter']]}
            value={get(SettingKeys.readerPercentageMode)} onChange={value => set(SettingKeys.readerPercentageMode, value)} />
        </>}
        {tab === 'colors' && <>
          <SectionLabel>Theme</SectionLabel>
          <View className="flex-row flex-wrap">
            {THEME_SWATCHES.map(([bg, tx, name]) => {
              const selected = style.bg.toLowerCase() === bg && style.tx.toLowerCase() === tx;
              return (
                <Pressable key={name} accessibilityRole="button" accessibilityLabel={name}
                  accessibilityState={{ selected }} onPress={() => onPatch({ bg, tx })}
                  className={`rounded-lg mr-2 mb-2 items-center justify-center px-3 py-2 ${pressFeedback}`}
                  style={{
                    backgroundColor: bg, borderWidth: 2, borderColor: selected ? accent.hex : colors.ln,
                  }}>
                  <Text style={{ color: tx }}>{name}</Text>
                </Pressable>
              );
            })}
          </View>
          <ColorSwatches label="Background" value={style.bg} options={BG_SWATCHES}
            onChange={(bg) => onPatch({ bg, tx: contrastText(bg) })} />
          <ColorSwatches label="Text" value={style.tx} options={TX_SWATCHES} onChange={(tx) => onPatch({ tx })} />
          <SliderRow label="Screen brightness" value={brightness} display={brightness + '%'} min={20}
            max={100} step={5} onChange={onBrightness} />
        </>}
      </ScrollView>
    </ReaderOptionsPopup>
  );
}
