import Constants from 'expo-constants';
import React from 'react';

import { Section } from '@/components/ui/controls';
import { SettingsPage } from './SettingsPage';

export default function AboutSettings() {
  const version = Constants.expoConfig?.version ?? '1.0.0';
  return (
    <SettingsPage title="About">
      <Section title="Sirum" description={`Offline-first reader for EPUB, TXT and PDF. Version ${version}.`} />
      <Section title="Privacy" description="Your books never leave this device. Sync sends only reading metadata, positions, short snippets and notes." />
      <Section title="Licenses" description="Sirum is built with Expo, React Native and open-source libraries." />
    </SettingsPage>
  );
}
