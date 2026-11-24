import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { AppBar, Screen } from '@/components/chrome/app-bar';
import { Icon, type IconName } from '@/components/ui/icon';
import { useSettings } from './SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';

const CATEGORIES: {
  route: string;
  icon: IconName;
  title: string;
  description: string;
}[] = [
  { route: '/settings-appearance', icon: 'color-palette', title: 'Appearance', description: 'Theme, accent color, app font' },
  { route: '/settings-library', icon: 'library', title: 'Library', description: 'Layout, order, display' },
  { route: '/settings-reader', icon: 'book', title: 'Reader', description: 'Reading display, progress' },
  { route: '/settings-import', icon: 'server-outline', title: 'Import and storage', description: 'Import method, storage access' },
  { route: '/settings-sync', icon: 'sync', title: 'Sync', description: 'Account, sync status' },
  { route: '/settings-about', icon: 'information-circle', title: 'About', description: 'Sirum' },
];

export default function SettingsHubScreen() {
  const router = useRouter();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromReader = from === 'reader';
  const { get } = useSettings();
  const navMode = get(SettingKeys.deviceNavMode);

  return (
    <Screen showNav={!fromReader}>
      <AppBar title="Settings" leading={fromReader ? 'back' : navMode === 'side' ? 'menu' : 'none'} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        {CATEGORIES.map((c) => (
          <Pressable
            key={c.route}
            accessibilityRole="button"
            onPress={() => router.push({ pathname: c.route, params: fromReader ? { from: 'reader' } : {} } as Href)}
            className="flex-row items-center gap-5 px-2 py-4"
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}>
            <Icon name={c.icon} size={24} tone="accent" />
            <View className="flex-1">
              <Text className="font-ui text-tx text-[17px] font-medium">{c.title}</Text>
              <Text className="font-ui text-mu text-[13px]">{c.description}</Text>
            </View>
            <Icon name="chevron-forward" size={18} tone="muted" />
          </Pressable>
        ))}
      </ScrollView>
    </Screen>
  );
}
