import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';

/**
 * Placeholder home/library screen.
 * Will be replaced with the full Library feature (Phase 3).
 */
export default function LibraryScreen() {
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safe}>
        <View style={styles.content}>
          <ThemedText type="title">Sirum</ThemedText>
          <ThemedText type="subtitle" style={styles.subtitle}>
            Your offline reader
          </ThemedText>
          <ThemedText type="small" style={styles.hint}>
            Library coming soon — import your first EPUB to get started.
          </ThemedText>
        </View>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safe: { flex: 1 },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    paddingHorizontal: Spacing.four,
  },
  subtitle: {
    textAlign: 'center',
  },
  hint: {
    textAlign: 'center',
    opacity: 0.6,
  },
});
