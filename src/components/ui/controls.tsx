import Slider from '@react-native-community/slider';
import React from 'react';
import { Pressable, Text, View } from 'react-native';

import { contrastText } from '@/lib/color';
import { useAppTheme } from '@/theme/ThemeProvider';

/** Selectable chip (prototype `.chip`). */
export function Chip({
  label,
  selected,
  onPress,
  disabled,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  disabled?: boolean;
}) {
  const { accent } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      className={`border rounded-2xl px-3 py-1.5 mr-1.5 mb-1.5 ${
        selected ? 'border-accent' : 'border-line'
      } ${disabled ? 'opacity-40' : ''}`}
      style={selected ? { backgroundColor: accent.acb } : undefined}>
      <Text
        className="font-ui text-tx"
        style={selected ? { color: contrastText(accent.acb) } : undefined}>
        {label}
      </Text>
    </Pressable>
  );
}

/** Row of single-select chips (prototype `.seg`). */
export function SegmentedControl<T extends string | number | boolean>({
  options,
  value,
  onChange,
  disabled,
}: {
  options: readonly (readonly [T, string])[];
  value: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row flex-wrap">
      {options.map(([v, label]) => (
        <Chip
          key={String(v)}
          label={label}
          selected={value === v}
          disabled={disabled}
          onPress={() => onChange(v)}
        />
      ))}
    </View>
  );
}

/** Grouped settings card (prototype `.set`). */
export function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <View className="bg-surface rounded-[14px] p-3.5 mb-3">
      <Text className="font-ui text-tx text-base font-semibold">{title}</Text>
      {description ? <Text className="font-ui text-mu text-[13px] mt-1 mb-2">{description}</Text> : <View className="mb-1" />}
      {children}
    </View>
  );
}

/** Section heading inside sheets/pages (prototype `h3`). */
export function SectionLabel({ children }: { children: React.ReactNode }) {
  return <Text className="font-ui text-mu text-[13px] font-medium mt-4 mb-2">{children}</Text>;
}

/** Labeled range slider (prototype `.sl` with input[type=range]). */
export function SliderRow({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display?: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  const { accent, colors } = useAppTheme();
  return (
    <View className="mb-3">
      <View className="flex-row justify-between mb-1">
        <Text className="font-ui text-mu text-[13px]">{label}</Text>
        <Text className="font-ui text-mu text-[13px] font-semibold">{display ?? value}</Text>
      </View>
      <Slider
        accessibilityLabel={label}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        onValueChange={onChange}
        minimumTrackTintColor={accent.hex}
        maximumTrackTintColor={colors.sf2}
        thumbTintColor={accent.hex}
      />
    </View>
  );
}

/** Row of color swatches for picking bg/text colors (replaces <input type=color>). */
export function ColorSwatches({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (hex: string) => void;
}) {
  const { accent, colors } = useAppTheme();
  return (
    <View className="mb-3">
      <Text className="font-ui text-mu text-[13px] mb-1.5">{label}</Text>
      <View className="flex-row flex-wrap">
        {options.map((hex) => {
          const selected = hex.toLowerCase() === value.toLowerCase();
          return (
            <Pressable
              key={hex}
              accessibilityRole="button"
              accessibilityLabel={`${label} ${hex}`}
              onPress={() => onChange(hex)}
              className="w-9 h-9 rounded-lg mr-2 mb-2 items-center justify-center"
              style={{
                backgroundColor: hex,
                borderWidth: selected ? 2 : 1,
                borderColor: selected ? accent.hex : colors.ln,
              }}>
              {selected && <View className="w-2.5 h-2.5 rounded-full bg-white/90" />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Primary button (prototype `.btn`). */
export function PrimaryButton({
  label,
  onPress,
  disabled,
  ghost,
}: {
  label: string;
  onPress?: () => void;
  disabled?: boolean;
  ghost?: boolean;
}) {
  const { accent } = useAppTheme();
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`rounded-full px-5 py-2.5 self-start mt-1 ${disabled ? 'opacity-40' : ''}`}
      style={{ backgroundColor: ghost ? 'transparent' : accent.hex }}>
      <Text
        className={ghost ? 'font-ui text-accent font-semibold' : 'font-ui font-semibold'}
        style={ghost ? undefined : { color: contrastText(accent.hex) }}>
        {label}
      </Text>
    </Pressable>
  );
}
