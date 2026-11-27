import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import '../../global.css';
import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { ChromeProvider } from '@/components/chrome/app-bar';
import { getDb } from '@/db/client';
import { AuthProvider } from '@/auth/session';
import { SettingsProvider } from '@/features/settings/SettingsProvider';
import { AppThemeProvider } from '@/theme/ThemeProvider';
import { logger } from '@/lib/logger';

export default function RootLayout() {
  useEffect(() => {
    getDb().catch((err) => logger.error('DB init failed', err));
  }, []);

  SplashScreen.preventAutoHideAsync();

  return (
    <SettingsProvider>
      <AppThemeProvider>
        <AuthProvider>
          <ChromeProvider>
            <AnimatedSplashOverlay />
            <Stack
              screenOptions={{
                headerShown: false,
                // Destination-based push/pop: a screen entered from the library,
                // history or settings slides in from the right, and going back
                // plays the reverse. The reader overrides this below.
                animation: 'slide_from_right',
              }}>
              <Stack.Screen name="index" />
              <Stack.Screen name="history" />
              <Stack.Screen name="import" />
              <Stack.Screen name="settings" />

              <Stack.Screen name="settings-appearance" />
              <Stack.Screen name="settings-library" />
              <Stack.Screen name="settings-reader" />
              <Stack.Screen name="settings-import" />
              <Stack.Screen name="settings-sync" />
              <Stack.Screen name="settings-about" />

              {/* Reader: immersive slide up from bottom */}
              <Stack.Screen
                name="reader/[id]"
                options={{
                  animation: 'slide_from_bottom',
                  animationDuration: 260,
                }}
              />
            </Stack>
          </ChromeProvider>
        </AuthProvider>
      </AppThemeProvider>
    </SettingsProvider>
  );
}
