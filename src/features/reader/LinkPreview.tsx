import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PrimaryButton } from '@/components/ui/controls';
import type { resolveBookLink } from '@/text/links';

type Props = {
  label: string;
  target: ReturnType<typeof resolveBookLink>;
  preview: string;
  loading: boolean;
  error?: string;
  onClose(): void;
  onOpen(): void;
};

export function LinkPreview({ label, target, preview, loading, error, onClose, onOpen }: Props) {
  const insets = useSafeAreaInsets();
  const external = target.kind === 'external';
  let message = preview || 'No passage text is available for this link.';
  if (target.kind === 'missing') message = 'This link is unavailable: ' + target.address;
  else if (external) message = target.address;
  else if (loading) message = 'Loading linked passage…';

  return (
    <View accessibilityViewIsModal className="justify-end bg-black/55"
      style={[StyleSheet.absoluteFill, { paddingTop: insets.top + 8, paddingBottom: insets.bottom + 12,
        paddingLeft: insets.left + 12, paddingRight: insets.right + 12 }]}>
      <Pressable accessible={false} onPress={onClose} style={StyleSheet.absoluteFill} />
      <View className="w-full max-w-[480px] self-center overflow-hidden rounded-[24px] border border-line bg-surface"
        style={{ maxHeight: '92%' }}>
        <ScrollView bounces={false} contentContainerStyle={{ padding: 16 }}>
          <Text accessibilityRole="header" className="font-ui text-tx text-lg font-semibold">
            {external ? 'Open external link?' : 'Linked passage'}
          </Text>
          <Text className="font-ui text-tx mt-2 text-[15px] font-semibold">{label}</Text>
          <View className="mt-3 rounded-xl bg-surface-2 px-4 py-3">
            <Text selectable className="font-ui text-tx leading-6">{error ?? message}</Text>
          </View>
          <View className="mt-3 flex-row flex-wrap justify-end gap-2">
            <PrimaryButton label="Continue reading" ghost onPress={onClose} />
            {target.kind !== 'missing' && !error &&
              <PrimaryButton label={external ? 'Open link' : 'Go to passage'} disabled={loading} onPress={onOpen} />}
          </View>
        </ScrollView>
      </View>
    </View>
  );
}
