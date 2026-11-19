import { Platform } from 'react-native';

import type {
  AccentChoice,
  AppFontChoice,
  AppThemeChoice,
} from '@/lib/settingsKeys';

/**
 * Theme palette for Sirum, mirroring sirum-ui-prototype.html.
 * Colors are stored as "R G B" triples so Tailwind opacity modifiers work
 * through the `rgb(var(--x) / <alpha-value>)` utilities in tailwind.config.js.
 */

export type Rgb = string; // "r g b"

export interface ThemePalette {
  bg: Rgb;
  sf: Rgb;
  sf2: Rgb;
  tx: Rgb;
  mu: Rgb;
  ln: Rgb;
}

const hexToRgb = (hex: string): Rgb => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`;
};

export const ThemePalettes: Record<'dark' | 'light' | 'sepia', ThemePalette> = {
  dark: {
    bg: hexToRgb('#000000'),
    sf: hexToRgb('#1c1c1e'),
    sf2: hexToRgb('#2c2c30'),
    tx: hexToRgb('#f2f2f2'),
    mu: hexToRgb('#9a9aa2'),
    ln: hexToRgb('#333333'),
  },
  light: {
    bg: hexToRgb('#f6f6f8'),
    sf: hexToRgb('#ffffff'),
    sf2: hexToRgb('#e9e9ee'),
    tx: hexToRgb('#18181b'),
    mu: hexToRgb('#62626c'),
    ln: hexToRgb('#d8d8de'),
  },
  sepia: {
    bg: hexToRgb('#f4ecd8'),
    sf: hexToRgb('#fbf5e6'),
    sf2: hexToRgb('#e8dcc0'),
    tx: hexToRgb('#4a3a22'),
    mu: hexToRgb('#7d6a4c'),
    ln: hexToRgb('#d9ccaa'),
  },
};

/** [bright, strong, lightAccent, softTint] — index 2/3 are used on light backgrounds. */
const ACCENTS: Record<AccentChoice, [string, string, string, string]> = {
  green: ['#52c98b', '#0e6b3a', '#0e7a46', '#bfeacf'],
  purple: ['#b9a7ff', '#4a3f8f', '#5b46c9', '#ddd5ff'],
  blue: ['#6cb6ff', '#17508f', '#1b66b8', '#cfe4ff'],
};

export interface ResolvedAccent {
  /** Main accent color (icons, active states). */
  ac: string;
  /** Deep accent used as a filled chip/pill background. */
  acb: string;
  /** Soft tint used for subtle accent backgrounds. */
  soft: string;
  /** Concrete hex for APIs that need a real color (e.g. icon props). */
  hex: string;
  hexStrong: string;
}

export function resolveAccent(choice: AccentChoice, isLight: boolean): ResolvedAccent {
  const [bright, strong, lightAccent, softTint] = ACCENTS[choice];
  const ac = isLight ? lightAccent : bright;
  const acb = isLight ? softTint : strong;
  return {
    ac,
    acb,
    soft: softTint,
    hex: ac,
    hexStrong: acb,
  };
}

const APP_FONTS: Record<AppFontChoice, string> = {
  system: Platform.select({ ios: 'System', default: 'sans-serif' }) ?? 'sans-serif',
  serif: 'serif',
  humanist: 'sans-serif',
  mono: 'monospace',
};

export function appFontFamily(choice: AppFontChoice): string {
  return APP_FONTS[choice];
}

export type ResolvedThemeName = 'dark' | 'light' | 'sepia';

export function resolveThemeName(
  choice: AppThemeChoice,
  systemScheme: 'light' | 'dark' | null | undefined
): ResolvedThemeName {
  if (choice !== 'system') return choice;
  if (systemScheme === 'light') return 'light';
  if (systemScheme === 'dark') return 'dark';
  // systemScheme can be null while the OS preference is still resolving
  return Platform.OS === 'android' ? 'dark' : 'light';
}

/** Build the CSS variable map consumed by NativeWind's vars(). */
export function themeVars(
  theme: ResolvedThemeName,
  accent: AccentChoice,
  appFont: AppFontChoice
): Record<string, string> {
  const p = ThemePalettes[theme];
  const isLight = theme !== 'dark';
  const a = resolveAccent(accent, isLight);
  return {
    '--bg': p.bg,
    '--sf': p.sf,
    '--sf2': p.sf2,
    '--tx': p.tx,
    '--mu': p.mu,
    '--ln': p.ln,
    '--ac': hexToRgb(a.ac),
    '--acb': hexToRgb(a.acb),
    '--ac-soft': hexToRgb(a.soft),
    '--font-ui': APP_FONTS[appFont],
  };
}
