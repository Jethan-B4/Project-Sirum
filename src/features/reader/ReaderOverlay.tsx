import React, { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { Animated, BackHandler, Easing, Modal, StyleSheet } from 'react-native';

export const ReaderMotion = createContext({ duration: 0, slide: false });

/** Keep the surface mounted through dismissal so interrupted transitions reverse in place. */
export function ReaderOverlay({ visible, inline, onClose, children }: {
  visible: boolean; inline?: boolean; onClose(): void; children: React.ReactNode;
}) {
  const { duration, slide } = useContext(ReaderMotion);
  const [mounted, setMounted] = useState(visible);
  const [progress] = useState(() => new Animated.Value(0));
  if (visible && !mounted) setMounted(true);
  if (!visible && !duration && mounted) setMounted(false);
  useLayoutEffect(() => {
    const target = visible ? 1 : 0;
    if (!duration || (!mounted && !visible)) {
      progress.setValue(target);
      return;
    }
    const animation = Animated.timing(progress, { toValue: target, duration, easing: Easing.out(Easing.cubic),
      useNativeDriver: true, isInteraction: false });
    animation.start(({ finished }) => { if (finished && !visible) setMounted(false); });
    return () => animation.stop();
  }, [visible, mounted, duration, progress]);
  useEffect(() => {
    if (!inline || !visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [inline, visible, onClose]);
  if (!visible && !mounted) return null;
  const surface = (
    <Animated.View pointerEvents={visible ? 'auto' : 'none'} accessibilityViewIsModal={visible}
      accessibilityElementsHidden={!visible} importantForAccessibility={visible ? 'auto' : 'no-hide-descendants'}
      style={[inline ? [StyleSheet.absoluteFill, { zIndex: 20 }] : { flex: 1 }, { opacity: progress,
        transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [slide ? 16 : 0, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
  if (inline) return surface;
  return <Modal visible transparent animationType="none" statusBarTranslucent navigationBarTranslucent
    supportedOrientations={['portrait', 'landscape']} onRequestClose={onClose}>{surface}</Modal>;
}
