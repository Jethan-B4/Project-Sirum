import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/**
 * Fire-and-forget haptics. Every call is best-effort: the web build and devices
 * without haptic support resolve without effect, and failures never surface to
 * the caller. Haptics carry no user data.
 */
function safely(trigger: () => Promise<unknown>) {
  if (Platform.OS === 'web') return;
  void trigger().catch(() => {});
}

export const haptics = {
  /** Light tick for selection changes, e.g. opening a context menu. */
  select: () => safely(() => Haptics.selectionAsync()),
  /** Light impact for a page or chapter turn. */
  impact: () => safely(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  /** Positive confirmation, e.g. a saved bookmark or completed undo. */
  success: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  /** Warn when a destructive change is committed. */
  warning: () => safely(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
};
