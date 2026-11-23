import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Bottom sheet (prototype `.sheet`): scrim + rounded panel sliding from the
 * bottom. Used for the library filter/sort sheet and the reader display sheet.
 */
export function BottomSheet({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <Modal
      supportedOrientations={['portrait', 'landscape']}
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Pressable className="absolute inset-0 bg-black/55" onPress={onClose} />
        <View
          className="bg-surface rounded-t-[20px] max-h-[82%]"
          style={{ paddingBottom: Math.max(insets.bottom, 16) + 8 }}>
          <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingTop: 18, paddingBottom: 12 }}>
            {title ? <Text className="font-ui text-tx text-base font-semibold">{title}</Text> : null}
            {children}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
