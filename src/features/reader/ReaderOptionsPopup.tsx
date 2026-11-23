import React, { useEffect } from 'react';
import { BackHandler, Modal, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/** Anchor both reader menus to the toolbar's trailing edge inside the safe area. */
export function ReaderOptionsPopup({ visible, onClose, toolbarHeight, inline, wide, children }: {
  visible: boolean; onClose(): void; toolbarHeight: number; inline?: boolean; wide?: boolean; children: React.ReactNode;
}) {
  useEffect(() => {
    if (!visible || !inline) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => subscription.remove();
  }, [inline, visible, onClose]);
  if (!visible) return null;
  // More can open another native modal (Contents). Keep that menu in the reader's safe area.
  const Frame = inline ? View : SafeAreaView;
  const panel = (
    <View accessibilityViewIsModal className={inline ? 'absolute inset-0 z-20' : 'flex-1'}>
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
  );
  if (inline) return panel;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}
      statusBarTranslucent navigationBarTranslucent supportedOrientations={['portrait', 'landscape']}>
      {panel}
    </Modal>
  );
}
