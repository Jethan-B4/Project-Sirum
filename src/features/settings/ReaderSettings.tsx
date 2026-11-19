import React from 'react';

import { Section, SegmentedControl } from '@/components/ui/controls';
import { ReadingStyleEditor, StylePreview } from '@/features/reader/ReadingStyleEditor';
import { DEFAULT_READING_STYLE, SettingKeys } from '@/lib/settingsKeys';
import { useSettings } from './SettingsProvider';
import { SettingsPage } from './SettingsPage';

export default function ReaderSettings() {
  const { get, getJson, set, setJson } = useSettings();
  const style = {
    ...DEFAULT_READING_STYLE,
    ...(getJson<Partial<typeof DEFAULT_READING_STYLE>>(SettingKeys.readerStyle) ?? {}),
  };

  return (
    <SettingsPage title="Reader">
      <Section
        title="Progress display"
        description="Show progress for the whole book or the current chapter.">
        <SegmentedControl
          options={[
            ['book', 'Whole book'],
            ['chapter', 'Current chapter'],
          ]}
          value={get(SettingKeys.readerPercentageMode)}
          onChange={(v) => set(SettingKeys.readerPercentageMode, v)}
        />
      </Section>
      <Section
        title="Reading display"
        description="Default for all books. Open Aa inside a book to give that book its own style.">
        <ReadingStyleEditor
          value={style}
          onChange={(patch) => setJson(SettingKeys.readerStyle, { ...style, ...patch })}
        />
        <StylePreview style={style} />
      </Section>
    </SettingsPage>
  );
}
