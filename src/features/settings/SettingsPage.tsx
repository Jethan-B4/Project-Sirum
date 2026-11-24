import React from 'react';
import { useLocalSearchParams } from 'expo-router';
import { ScrollView } from 'react-native';

import { AppBar, Screen } from '@/components/chrome/app-bar';

/** Shared shell for settings sub-pages: back button + scrolling content. */
export function SettingsPage({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  const { from } = useLocalSearchParams<{ from?: string }>();
  return (
    <Screen showNav={from !== 'reader'}>
      <AppBar title={title} leading="back" />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
        {children}
      </ScrollView>
    </Screen>
  );
}
