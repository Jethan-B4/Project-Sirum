import { vars } from 'nativewind';
import React, { createContext, useContext, useMemo } from 'react';
import { View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import { useSettings } from '@/features/settings/SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';
import {
  appFontFamily,
  resolveAccent,
  resolveThemeName,
  themeVars,
  type ResolvedAccent,
  type ResolvedThemeName,
} from './palette';

export interface AppTheme {
  /** 'system' resolved against the OS, then mapped to a concrete palette. */
  name: ResolvedThemeName;
  isDark: boolean;
  isLight: boolean;
  accent: ResolvedAccent;
  appFont: string;
}

const AppThemeContext = createContext<AppTheme | null>(null);

export function AppThemeProvider({ children }: { children: React.ReactNode }) {
  const scheme = useColorScheme();
  const { get } = useSettings();

  const themeChoice = get(SettingKeys.deviceTheme);
  const accentChoice = get(SettingKeys.deviceAccent);
  const fontChoice = get(SettingKeys.deviceAppFont);

  const theme = useMemo<AppTheme>(() => {
    const name = resolveThemeName(themeChoice, scheme);
    const isDark = name === 'dark';
    return {
      name,
      isDark,
      isLight: !isDark,
      accent: resolveAccent(accentChoice, !isDark),
      appFont: appFontFamily(fontChoice),
    };
  }, [scheme, themeChoice, accentChoice, fontChoice]);

  const varStyle = useMemo(
    () => vars(themeVars(theme.name, accentChoice, fontChoice)) as object,
    [theme.name, accentChoice, fontChoice]
  );

  return (
    <AppThemeContext.Provider value={theme}>
      <View style={[{ flex: 1 }, varStyle]}>{children}</View>
    </AppThemeContext.Provider>
  );
}

export function useAppTheme(): AppTheme {
  const ctx = useContext(AppThemeContext);
  if (!ctx) throw new Error('useAppTheme must be used inside <AppThemeProvider>');
  return ctx;
}
