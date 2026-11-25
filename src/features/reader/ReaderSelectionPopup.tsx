import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { pressFeedback } from '@/components/ui/press-feedback';
import { useAppTheme } from '@/theme/ThemeProvider';
import { contrastText } from '@/lib/color';
import { ReaderOverlay } from './ReaderOverlay';
import type { SelectionAnchor } from './textSelection';

export const HIGHLIGHT_COLORS = [null, '#f4e88b', '#c8ef9b', '#70d5b1', '#83c4ed', '#ef8e91', '#c2a0ef'] as const;
export type SelectionAction = 'copy' | 'share' | 'search' | 'ask' | 'read' | 'reddit' | 'dictionary' | 'apps';

export function ReaderSelectionPopup({
  visible,
  text,
  anchor,
  color,
  underline,
  note,
  onClose,
  onSelectAll,
  onAction,
  onColor,
  onUnderline,
  onNoteChange,
  onSaveNote,
}: {
  visible: boolean;
  text: string;
  anchor: SelectionAnchor;
  color: string | null;
  underline: boolean;
  note: string;
  onClose(): void;
  onSelectAll(): void;
  onAction(action: SelectionAction): void;
  onColor(color: string | null): void;
  onUnderline(): void;
  onNoteChange(note: string): void;
  onSaveNote(): void;
}) {
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();
  const { height } = useWindowDimensions();
  const [more, setMore] = useState(false);
  const [popupHeight, setPopupHeight] = useState(Math.min(height * 0.62, 420));
  const maxTop = Math.max(insets.top + 8, height - insets.bottom - popupHeight - 8);
  const fitsBelow = height - insets.bottom - anchor.y - 12 >= popupHeight;
  const top = Math.max(insets.top + 8, Math.min(fitsBelow ? anchor.y + 12 : anchor.y - popupHeight - 12, maxTop));

  return (
    <ReaderOverlay inline visible={visible} onClose={onClose}>
      <View pointerEvents="box-none" className="flex-1">
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss selection actions" onPress={onClose}
          className="absolute inset-0" />
        <View onLayout={event => setPopupHeight(event.nativeEvent.layout.height)}
          className="absolute self-center w-full max-w-[520px] overflow-hidden rounded-xl border border-line bg-surface-2 shadow-lg"
          style={{ top, left: 12, right: 12 }}>
          <ScrollView style={{ maxHeight: Math.min(180, Math.max(96, height * 0.24)) }}
            contentContainerStyle={{ paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4 }}>
            <Text className="font-ui text-tx text-[14px]">{text}</Text>
          </ScrollView>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingHorizontal: 8, paddingTop: 6 }}>
            <Action label="Select All" icon="list-outline" onPress={onSelectAll} />
            <Action label="Copy" icon="copy-outline" onPress={() => onAction('copy')} />
            <Action label="Share" icon="share-outline" onPress={() => onAction('share')} />
            <Action label="Search" icon="search-outline" onPress={() => onAction('search')} />
            <Action label="More" icon="ellipsis-vertical" onPress={() => setMore(value => !value)} />
          </ScrollView>
          {more && (
            <View className="flex-row flex-wrap border-t border-line px-2 py-1">
              <MoreAction label="Ask Gemini" onPress={() => onAction('ask')} />
              <MoreAction label="Read aloud" onPress={() => onAction('read')} />
              <MoreAction label="Reddit search" onPress={() => onAction('reddit')} />
              <MoreAction label="English / dictionary" onPress={() => onAction('dictionary')} />
              <MoreAction label="More apps" onPress={() => onAction('apps')} />
            </View>
          )}
          <View className="flex-row items-center border-t border-line">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexGrow: 1, alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 10 }}>
              {HIGHLIGHT_COLORS.map((swatch, index) => {
                const selected = color === swatch;
                return (
                  <Pressable key={swatch ?? 'none'} accessibilityRole="button"
                    accessibilityLabel={swatch ? `Highlight color ${index}` : 'Remove highlight'}
                    accessibilityState={{ selected }} onPress={() => onColor(swatch)}
                    className={`h-8 w-8 items-center justify-center rounded-full ${pressFeedback}`}
                    style={{ borderWidth: selected ? 2 : 1, borderColor: selected ? accent.hex : 'rgba(127,127,127,0.5)' }}>
                    <View className="h-6 w-6 rounded-full items-center justify-center"
                      style={{ backgroundColor: swatch ?? 'transparent', borderWidth: swatch ? 0 : 1, borderStyle: 'dashed', borderColor: '#888' }}>
                      {!swatch && <Icon name="close" size={14} tone="muted" />}
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
            <Pressable accessibilityRole="button" accessibilityLabel="Toggle underline"
              accessibilityState={{ selected: underline }} onPress={onUnderline}
              className={`h-12 px-4 items-center justify-center border-l border-line ${pressFeedback}`}>
              <Text className="font-ui text-[20px] font-semibold" style={{ color: underline ? accent.hex : undefined }}>U̲</Text>
            </Pressable>
          </View>
          <View className="flex-row items-center border-t border-line px-4 py-2">
            <TextInput value={note} onChangeText={onNoteChange} placeholder="Tap to add a note"
              placeholderTextColor="#a0a0a0" multiline returnKeyType="done" style={{ maxHeight: 72 }}
              className="font-ui text-tx flex-1 text-[15px] py-1" accessibilityLabel="Highlight note" />
            <Pressable accessibilityRole="button" accessibilityLabel="Save note" onPress={onSaveNote}
              className={`ml-2 rounded-lg px-3 py-2 ${pressFeedback}`} style={{ backgroundColor: accent.hexStrong }}>
              <Text className="font-ui text-[13px] font-semibold" style={{ color: contrastText(accent.hexStrong) }}>Save</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </ReaderOverlay>
  );
}

function Action({ label, icon, onPress }: { label: string; icon: React.ComponentProps<typeof Icon>['name']; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={`min-w-[66px] items-center justify-center gap-1 px-2 py-2 ${pressFeedback}`}>
      <Icon name={icon} size={19} tone="default" />
      <Text className="font-ui text-tx text-[11px]">{label}</Text>
    </Pressable>
  );
}

function MoreAction({ label, onPress }: { label: string; onPress(): void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className={`rounded-lg px-3 py-2 ${pressFeedback}`}>
      <Text className="font-ui text-tx text-[13px]">{label}</Text>
    </Pressable>
  );
}
