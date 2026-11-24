import { ReaderOverlay } from './ReaderOverlay';
import React from 'react';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Anchor both reader menus to the toolbar's trailing edge inside the safe area. */
export function ReaderOptionsPopup({ visible, onClose, toolbarHeight, wide, children }: {
  visible: boolean; onClose(): void; toolbarHeight: number; wide?: boolean; children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <ReaderOverlay visible={visible} inline onClose={onClose}>
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'flex-end', marginLeft: insets.left + 12,
        marginRight: insets.right + 12, marginTop: toolbarHeight + 4, marginBottom: insets.bottom + 8 }}>
        <View className="rounded-xl bg-surface-2 overflow-hidden border border-line"
          style={{ width: '100%', maxWidth: wide ? 380 : 260, maxHeight: '100%' }}>
          {children}
        </View>
      </View>
    </ReaderOverlay>
  );
}
