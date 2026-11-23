import Ionicons from '@expo/vector-icons/Ionicons';
import React from 'react';
import { Pressable, View } from 'react-native';

import { contrastText } from '@/lib/color';
import { useAppTheme } from '@/theme/ThemeProvider';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];

type Tone = 'default' | 'muted' | 'accent' | 'onAccent' | (string & {});

function useIconColor(tone: Tone): string {
  const { accent, colors } = useAppTheme();
  if (tone === 'accent') return accent.hex;
  if (tone === 'onAccent') return contrastText(accent.hex);
  if (tone === 'muted') return colors.mu;
  if (tone === 'default') return colors.tx;
  return tone; // concrete color passed through
}

interface IconProps {
  name: IconName;
  size?: number;
  tone?: Tone;
  style?: object;
}

/** Theme-aware Ionicons wrapper (the prototype's stroke icons map to these). */
export function Icon({ name, size = 24, tone = 'default', style }: IconProps) {
  const color = useIconColor(tone);
  return <Ionicons name={name} size={size} color={color} style={style} />;
}

/** Circular icon button used in app bars and cards (prototype `.ib`). */
export function IconButton({
  icon,
  label,
  onPress,
  tone = 'default',
  size = 24,
}: {
  icon: IconName;
  label: string;
  onPress?: () => void;
  tone?: Tone;
  size?: number;
}) {
  const color = useIconColor(tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      className="p-2 rounded-full"
      style={({ pressed }) => (pressed ? { opacity: 0.6 } : undefined)}>
      <Ionicons name={icon} size={size} color={color} />
    </Pressable>
  );
}

/** Play affordance overlaid on covers (prototype `.pl`). */
export function PlayBadge() {
  const { accent } = useAppTheme();
  return (
    <View
      className="absolute bottom-2 right-2 w-[34px] h-[34px] rounded-[10px] items-center justify-center"
      style={{ backgroundColor: accent.hexStrong }}>
      <Ionicons name="play" size={18} color={contrastText(accent.hexStrong)} />
    </View>
  );
}
