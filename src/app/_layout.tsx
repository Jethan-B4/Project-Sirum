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

export default function RootLayout() {
  useEffect(() => {
    getDb().catch((err) => console.error('DB init failed', err));
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
                animation: 'fade', // Smooth crossfade default for top-level navigation
                animationDuration: 180,
              }}>
              {/* Primary tab-level screens with instant/crossfade transitions */}
              <Stack.Screen name="index" options={{ animation: 'fade' }} />
              <Stack.Screen name="history" options={{ animation: 'fade' }} />
              <Stack.Screen name="import" options={{ animation: 'fade' }} />
              <Stack.Screen name="settings" options={{ animation: 'fade' }} />

              {/* Sub-settings pages with smooth hierarchical slide */}
              <Stack.Screen name="settings-appearance" options={{ animation: 'slide_from_right', animationDuration: 220 }} />
              <Stack.Screen name="settings-library" options={{ animation: 'slide_from_right', animationDuration: 220 }} />
              <Stack.Screen name="settings-reader" options={{ animation: 'slide_from_right', animationDuration: 220 }} />
              <Stack.Screen name="settings-import" options={{ animation: 'slide_from_right', animationDuration: 220 }} />
              <Stack.Screen name="settings-sync" options={{ animation: 'slide_from_right', animationDuration: 220 }} />
              <Stack.Screen name="settings-about" options={{ animation: 'slide_from_right', animationDuration: 220 }} />

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
