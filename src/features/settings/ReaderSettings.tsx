import React from 'react';

import { Section, SectionLabel, SegmentedControl, SliderRow } from '@/components/ui/controls';
import { ReadingStyleEditor, StylePreview } from '@/features/reader/ReadingStyleEditor';
import { DEFAULT_READING_STYLE, normalizeStylePatch, SettingKeys } from '@/lib/settingsKeys';
import { useSettings } from './SettingsProvider';
import { SettingsPage } from './SettingsPage';

export default function ReaderSettings() {
  const { get, getJson, set, setJson } = useSettings();
  const style = {
    ...DEFAULT_READING_STYLE,
    ...(normalizeStylePatch(
      getJson<Partial<typeof DEFAULT_READING_STYLE>>(SettingKeys.readerStyle)
    ) ?? {}),
  };

  return (
    <SettingsPage title="Reader">
      <Section title="Chapter navigation">
        <SectionLabel>Turn with edge taps</SectionLabel>
        <SegmentedControl options={[[true, 'On'], [false, 'Off']]} value={get(SettingKeys.readerEdgeTaps)}
          onChange={(value) => set(SettingKeys.readerEdgeTaps, value)} />
        <SectionLabel>Next chapter button</SectionLabel>
        <SegmentedControl options={[[true, 'Show'], [false, 'Hide']]} value={get(SettingKeys.readerNextButton)}
          onChange={(value) => set(SettingKeys.readerNextButton, value)} />
        <SectionLabel>Transition style</SectionLabel>
        <SegmentedControl options={[['fade', 'Fade'], ['slide', 'Slide'], ['none', 'None']]} value={get(SettingKeys.readerTransition)}
          onChange={(value) => set(SettingKeys.readerTransition, value)} />
        <SectionLabel>Transition speed</SectionLabel>
        <SegmentedControl options={[['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']]}
          disabled={get(SettingKeys.readerTransition) === 'none'} value={get(SettingKeys.readerTransitionSpeed)}
          onChange={(value) => set(SettingKeys.readerTransitionSpeed, value)} />
      </Section>
      <Section
        title="Progress display"
        description="Choose the progress scope and whether to show the chapter number alongside the percentage.">
        <SegmentedControl
          options={[
            ['book', 'Whole book'],
            ['chapter', 'Current chapter'],
          ]}
          value={get(SettingKeys.readerPercentageMode)}
          onChange={(v) => set(SettingKeys.readerPercentageMode, v)}
        />
        <SectionLabel>Chapter count in the progress bar</SectionLabel>
        <SegmentedControl
          options={[[false, 'Simple'], [true, 'Show chapter count']]}
          value={get(SettingKeys.readerProgressChapterCount)}
          onChange={(v) => set(SettingKeys.readerProgressChapterCount, v)}
        />
      </Section>
      <Section
        title="Reading display"
        description="These are the defaults for all books. Aa inside a book changes only that book.">
        <ReadingStyleEditor
          value={style}
          onChange={(patch) => setJson(SettingKeys.readerStyle, { ...style, ...patch })}
        />
        <StylePreview style={style} />
      </Section>
      <Section
        title="Brightness"
        description="Reader screen brightness. The system value is restored when you leave a book.">
        <SliderRow
          label="Brightness"
          value={get(SettingKeys.deviceReaderBrightness)}
          display={`${get(SettingKeys.deviceReaderBrightness)}%`}
          min={20}
          max={100}
          step={5}
          onChange={(v) => set(SettingKeys.deviceReaderBrightness, v)}
        />
      </Section>
    </SettingsPage>
  );
}
