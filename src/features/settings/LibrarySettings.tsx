import React from 'react';

import { Section, SegmentedControl } from '@/components/ui/controls';
import { useSettings } from './SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';
import { SettingsPage } from './SettingsPage';

export default function LibrarySettings() {
  const { get, set } = useSettings();
  return (
    <SettingsPage title="Library">
      <Section title="Navigation layout" description="Bottom bar, or a hidden side drawer.">
        <SegmentedControl
          options={[
            ['bottom', 'Bottom bar'],
            ['side', 'Side drawer'],
          ]}
          value={get(SettingKeys.deviceNavMode)}
          onChange={(v) => set(SettingKeys.deviceNavMode, v)}
        />
      </Section>
      <Section
        title="Default library layout"
        description="Starting layout only. Change view and grid size anytime from the filter button.">
        <SegmentedControl
          options={[
            ['cols2', '2 columns'],
            ['cols3', '3 columns'],
          ]}
          value={get(SettingKeys.deviceLibraryLayout)}
          onChange={async (v) => {
            await set(SettingKeys.deviceLibraryLayout, v);
            // Choosing a default layout resets the view to grid at that size.
            await set(SettingKeys.deviceViewMode, 'grid');
            await set(SettingKeys.deviceGridSize, v === 'cols2' ? 2 : 3);
          }}
        />
      </Section>
      <Section
        title="Library order"
        description="Whether opening a book moves it to the top of the library.">
        <SegmentedControl
          options={[
            ['recent', 'Recently opened first'],
            ['fixed', 'Fixed order'],
          ]}
          value={get(SettingKeys.libraryOrderMode)}
          onChange={(v) => set(SettingKeys.libraryOrderMode, v)}
        />
      </Section>
      <Section
        title="Format and progress badges"
        description="The format label and progress percent on covers.">
        <SegmentedControl
          options={[
            [true, 'Show'],
            [false, 'Hide'],
          ]}
          value={get(SettingKeys.deviceShowBadges)}
          onChange={(v) => set(SettingKeys.deviceShowBadges, v)}
        />
      </Section>
      <Section
        title="Title and author"
        description="Shown under or over covers in grid view. List view always shows them.">
        <SegmentedControl
          options={[
            [true, 'Show'],
            [false, 'Hide'],
          ]}
          value={get(SettingKeys.deviceShowDetails)}
          onChange={(v) => set(SettingKeys.deviceShowDetails, v)}
        />
      </Section>
      <Section
        title="Cover fit"
        description="Show the whole cover, or always fill the frame (may crop wide or square art).">
        <SegmentedControl
          options={[
            ['full', 'Show full cover'],
            ['crop', 'Fill frame'],
          ]}
          value={get(SettingKeys.deviceCoverFit)}
          onChange={(v) => set(SettingKeys.deviceCoverFit, v)}
        />
      </Section>
    </SettingsPage>
  );
}
