import React from 'react';
import { Text, View } from 'react-native';

import {
  Chip,
  ColorSwatches,
  SectionLabel,
  SegmentedControl,
  SliderRow,
} from '@/components/ui/controls';
import type { ReadingStyle } from '@/lib/settingsKeys';

/** Presets from the prototype: Dark / Light / Sepia. */
export const STYLE_PRESETS: readonly (readonly [string, string, string])[] = [
  ['Dark', '#121212', '#e6e6e6'],
  ['Light', '#fafafa', '#1a1a1a'],
  ['Sepia', '#f4ecd8', '#4a3a22'],
];

export const BG_SWATCHES = ['#121212', '#1e1e1e', '#0f1b2d', '#fafafa', '#f4ecd8', '#ffffff'];
export const TX_SWATCHES = ['#e6e6e6', '#1a1a1a', '#4a3a22', '#ffd9a0', '#cfe4ff', '#d7ffd9'];

const FAMILIES: readonly (readonly ['serif' | 'sans' | 'mono', string])[] = [
  ['serif', 'Serif'],
  ['sans', 'Sans'],
  ['mono', 'Mono'],
];
const WEIGHTS: readonly (readonly [400 | 500 | 700, string])[] = [
  [400, 'Regular'],
  [500, 'Medium'],
  [700, 'Bold'],
];

/** RN fontFamily for a reading-style family choice. */
export function readingFontFamily(fam: ReadingStyle['fam']): string {
  return fam === 'serif' ? 'serif' : fam === 'mono' ? 'monospace' : 'sans-serif';
}

/**
 * Reading display editor (prototype `rdc()`): presets, font, weight,
 * size / line height / margins sliders, and background/text color swatches.
 */
export function ReadingStyleEditor({
  value,
  onChange,
}: {
  value: ReadingStyle;
  onChange: (patch: Partial<ReadingStyle>) => void;
}) {
  return (
    <View>
      <SectionLabel>Preset</SectionLabel>
      <View className="flex-row flex-wrap">
        {STYLE_PRESETS.map(([name, bg, tx]) => (
          <Chip
            key={name}
            label={name}
            onPress={() => onChange({ bg, tx })}
          />
        ))}
      </View>

      <SectionLabel>Font</SectionLabel>
      <SegmentedControl
        options={FAMILIES}
        value={value.fam}
        onChange={(fam) => onChange({ fam })}
      />

      <SectionLabel>Weight</SectionLabel>
      <SegmentedControl
        options={WEIGHTS}
        value={value.wt}
        onChange={(wt) => onChange({ wt })}
      />

      <SliderRow
        label="Size"
        value={value.size}
        min={14}
        max={28}
        step={1}
        onChange={(size) => onChange({ size })}
      />
      <SliderRow
        label="Line height"
        value={value.lh}
        display={value.lh.toFixed(1)}
        min={1.2}
        max={2.2}
        step={0.1}
        onChange={(lh) => onChange({ lh })}
      />
      <SliderRow
        label="Margins"
        value={value.mar}
        min={0}
        max={48}
        step={2}
        onChange={(mar) => onChange({ mar })}
      />
      <ColorSwatches
        label="Background color"
        value={value.bg}
        options={BG_SWATCHES}
        onChange={(bg) => onChange({ bg })}
      />
      <ColorSwatches
        label="Text color"
        value={value.tx}
        options={TX_SWATCHES}
        onChange={(tx) => onChange({ tx })}
      />
    </View>
  );
}

/** Live preview block (prototype `.rprev`). */
export function StylePreview({ style }: { style: ReadingStyle }) {
  return (
    <View
      className="rounded-xl my-3 p-4"
      style={{ backgroundColor: style.bg }}>
      <Text
        style={{
          color: style.tx,
          fontFamily: readingFontFamily(style.fam),
          fontWeight: String(style.wt) as '400' | '500' | '700',
          fontSize: style.size,
          lineHeight: Math.round(style.size * style.lh),
        }}>
        The lamp on the quay had been lit for an hour before anyone noticed the boat was
        gone.{'\n\n'}“It didn’t drift,” she said. “Somebody took it, and they wanted us to
        see the lamp.”
      </Text>
    </View>
  );
}
