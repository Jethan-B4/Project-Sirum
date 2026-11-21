import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip, ColorSwatches, SectionLabel, SegmentedControl, SliderRow } from '@/components/ui/controls';
import type { ReadingStyle } from '@/lib/settingsKeys';
import { BG_SWATCHES, TX_SWATCHES } from './ReadingStyleEditor';

/** Prototype theme swatches: [background, text] pairs. */
const THEME_SWATCHES: readonly (readonly [string, string, string])[] = [
  ['#ffffff', '#1a1a1a', 'White'],
  ['#2b2b2e', '#e0e0e0', 'Dark gray'],
  ['#000000', '#e6e6e6', 'Black'],
  ['#f1e4c3', '#4a3a22', 'Sepia'],
];

/**
 * Display popup opened from the reader's "Aa" button (prototype `.disp`).
 * Writes `reader.style` (or the per-book override when scoped to this book).
 */
export function DisplayPopup({
  visible,
  onClose,
  style,
  scope,
  onScopeChange,
  hasOverride,
  onResetBook,
  brightness,
  onBrightness,
  onPatch,
}: {
  visible: boolean;
  onClose: () => void;
  style: ReadingStyle;
  scope: 'all' | 'book';
  onScopeChange: (s: 'all' | 'book') => void;
  hasOverride: boolean;
  onResetBook: () => void;
  /** Device-local brightness, 20–100 (device.readerBrightness). */
  brightness: number;
  onBrightness: (v: number) => void;
  onPatch: (patch: Partial<ReadingStyle>) => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View className="flex-1">
        <Pressable className="absolute inset-0 bg-black/55" onPress={onClose} />
        <View
          className="absolute bg-surface rounded-xl left-3 right-10"
          style={{ top: insets.top + 64, maxHeight: '75%' }}>
          <ScrollView contentContainerStyle={{ paddingVertical: 8 }}>
            {/* Scope: prototype omits this; the plan requires it (5.6.1). */}
            <View className="px-4 pt-1 pb-2">
              <SegmentedControl
                options={[
                  ['all', 'All books'],
                  ['book', 'This book only'],
                ]}
                value={scope}
                onChange={onScopeChange}
              />
            </View>
            {scope === 'book' && hasOverride && (
              <View className="px-4 pb-1">
                <Chip label="Reset this book" onPress={onResetBook} />
              </View>
            )}

            <SectionLabel>Flow</SectionLabel>
            <View className="px-4">
              <SegmentedControl
                options={[
                  ['auto', 'Auto'],
                  ['paged', 'Paged'],
                  ['scrolled', 'Scrolled'],
                ]}
                value={style.flow}
                onChange={(flow) => onPatch({ flow })}
              />
            </View>

            <SectionLabel>Brightness</SectionLabel>
            <View className="px-4">
              <SliderRow
                label="Screen"
                value={brightness}
                display={`${brightness}%`}
                min={20}
                max={100}
                step={5}
                onChange={onBrightness}
              />
            </View>

            <SectionLabel>Theme</SectionLabel>
            <View className="px-4 flex-row flex-wrap">
              {THEME_SWATCHES.map(([bg, tx, name]) => {
                const on = style.bg.toLowerCase() === bg && style.tx.toLowerCase() === tx;
                return (
                  <Pressable
                    key={name}
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    accessibilityState={{ selected: on }}
                    onPress={() => onPatch({ bg, tx })}
                    className="w-11 h-11 rounded-full mr-3 mb-2 items-center justify-center"
                    style={{
                      backgroundColor: bg,
                      borderWidth: 2,
                      borderColor: on ? 'rgb(var(--ac))' : 'rgb(var(--ln))',
                    }}>
                    {on && <Text className="text-[14px] font-bold" style={{ color: tx }}>✓</Text>}
                  </Pressable>
                );
              })}
            </View>
            <View className="px-4">
              <ColorSwatches
                label="Background"
                value={style.bg}
                options={BG_SWATCHES}
                onChange={(bg) => onPatch({ bg })}
              />
              <ColorSwatches
                label="Text"
                value={style.tx}
                options={TX_SWATCHES}
                onChange={(tx) => onPatch({ tx })}
              />
            </View>

            <SectionLabel>Text size</SectionLabel>
            <View className="px-4">
              <SliderRow
                label="Size"
                value={style.size}
                display={`${style.size}%`}
                min={60}
                max={200}
                step={10}
                onChange={(size) => onPatch({ size })}
              />
            </View>

            <SectionLabel>Text align</SectionLabel>
            <View className="px-4">
              <SegmentedControl
                options={[
                  ['left', 'Left'],
                  ['justify', 'Justify'],
                ]}
                value={style.align}
                onChange={(align) => onPatch({ align })}
              />
            </View>

            <SectionLabel>Margin</SectionLabel>
            <View className="px-4">
              <SliderRow
                label="Margin"
                value={style.mar}
                display={`${style.mar}%`}
                min={0}
                max={10}
                step={1}
                onChange={(mar) => onPatch({ mar })}
              />
            </View>
            <View className="h-3" />
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
