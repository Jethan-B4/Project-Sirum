import React from 'react';
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
  return (
    <Screen>
      <AppBar title={title} leading="back" />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 32 }}>
        {children}
      </ScrollView>
    </Screen>
  );
}
