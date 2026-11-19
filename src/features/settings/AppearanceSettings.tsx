import React from 'react';

import { Section, SegmentedControl } from '@/components/ui/controls';
import { useSettings } from './SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';
import { SettingsPage } from './SettingsPage';

export default function AppearanceSettings() {
  const { get, set } = useSettings();
  return (
    <SettingsPage title="Appearance">
      <Section title="Color theme" description="Applies to the whole app.">
        <SegmentedControl
          options={[
            ['system', 'System'],
            ['dark', 'Dark'],
            ['light', 'Light'],
            ['sepia', 'Sepia'],
          ]}
          value={get(SettingKeys.deviceTheme)}
          onChange={(v) => set(SettingKeys.deviceTheme, v)}
        />
      </Section>
      <Section title="Accent color" description="Buttons, tabs and highlights.">
        <SegmentedControl
          options={[
            ['green', 'Green'],
            ['purple', 'Purple'],
            ['blue', 'Blue'],
          ]}
          value={get(SettingKeys.deviceAccent)}
          onChange={(v) => set(SettingKeys.deviceAccent, v)}
        />
      </Section>
      <Section
        title="App font"
        description="Menus and library. The reading font is set under Reader.">
        <SegmentedControl
          options={[
            ['system', 'System'],
            ['serif', 'Serif'],
            ['humanist', 'Humanist'],
            ['mono', 'Mono'],
          ]}
          value={get(SettingKeys.deviceAppFont)}
          onChange={(v) => set(SettingKeys.deviceAppFont, v)}
        />
      </Section>
    </SettingsPage>
  );
}
