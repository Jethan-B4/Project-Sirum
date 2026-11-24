import { ReaderOverlay } from './ReaderOverlay';
import React from 'react';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Anchor both reader menus to the toolbar's trailing edge inside the safe area. */
export function ReaderOptionsPopup({ visible, onClose, toolbarHeight, inline, wide, children }: {
  visible: boolean; onClose(): void; toolbarHeight: number; inline?: boolean; wide?: boolean; children: React.ReactNode;
}) {
  // More can open another native modal (Contents). Keep that menu in the reader's safe area.
  const Frame = inline ? View : SafeAreaView;
  return (
    <ReaderOverlay visible={visible} inline={inline} onClose={onClose}>
      <View accessibilityViewIsModal className="flex-1">
        <Pressable accessible={false} onPress={onClose} className="absolute inset-0 bg-black/55" />
        <Frame pointerEvents="box-none" style={{ flex: 1 }}>
          <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'flex-end', marginHorizontal: 12,
            marginTop: toolbarHeight + 4, marginBottom: 8 }}>
            <View className="rounded-xl bg-surface-2 overflow-hidden border border-line"
              style={{ width: '100%', maxWidth: wide ? 380 : 260, maxHeight: '100%' }}>
              {children}
            </View>
          </View>
        </Frame>
      </View>
    </ReaderOverlay>
  );
}
