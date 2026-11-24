import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Animated, Easing } from 'react-native';
import { usePanGesture } from 'react-native-gesture-handler';
import { ReaderMotion } from './ReaderOverlay';

export type Direction = -1 | 1;
export type TurnDestination = { view: ReactNode; commit(): void };
type Drag = {
  step: Direction; released: boolean; destination?: TurnDestination;
};

export function useSwipeTurn(width: number, enabled: boolean,
  prepare: (step: Direction) => TurnDestination | Promise<TurnDestination | null> | null,
  immediate: (step: Direction) => void, onStart?: () => void) {
  const { duration, slide } = useContext(ReaderMotion);
  const [progress] = useState(() => new Animated.Value(0));
  const [preview, setPreview] = useState<{ step: Direction; view: ReactNode } | null>(null);
  const drag = useRef<Drag | null>(null);
  const lastSwipe = useRef(0);
  const fraction = useRef(0);
  useEffect(() => () => { drag.current = null; progress.stopAnimation(); }, [progress]);

  function clear() {
    drag.current = null;
    progress.stopAnimation();
    progress.setValue(0);
    setPreview(null);
  }
  function settle(current: Drag, commit: boolean) {
    const toValue = commit ? 1 : 0;
    Animated.timing(progress, { toValue, duration: Math.round(duration * Math.abs(toValue - fraction.current)),
      easing: Easing.out(Easing.cubic), useNativeDriver: true, isInteraction: false }).start(({ finished }) => {
      if (!finished || drag.current !== current) return;
      if (commit) current.destination?.commit();
      clear();
    });
  }
  function update(x: number) {
    if (!duration || x === 0 && !drag.current) return;
    const step = x === 0 ? drag.current!.step : x < 0 ? 1 : -1;
    const current = drag.current;
    if (!current || current.step !== step) {
      clear();
      const started: Drag = { step, released: false };
      drag.current = started;
      void Promise.resolve(prepare(step)).then(destination => {
        if (drag.current !== started) return;
        if (!destination) { if (started.released) clear(); return; }
        started.destination = destination;
        setPreview({ step, view: destination.view });
        if (started.released) settle(started, true);
      }).catch(() => { if (drag.current === started) clear(); });
    }
    fraction.current = Math.min(1, Math.abs(x) / width);
    progress.setValue(fraction.current);
  }
  const pan = usePanGesture({
    enabled, activeOffsetX: [-16, 16], failOffsetY: [-12, 12], maxPointers: 1, runOnJS: true,
    onActivate: e => { clear(); onStart?.(); update(e.translationX); },
    onUpdate: e => update(e.translationX),
    onDeactivate: e => {
      lastSwipe.current = Date.now();
      const distance = Math.abs(e.translationX);
      const commit = !e.canceled && distance > Math.abs(e.translationY) &&
        (distance >= Math.min(96, width * 0.24) || (distance > 18 && e.translationX * e.velocityX > 0 && Math.abs(e.velocityX) >= 650));
      if (!duration) { if (commit) immediate(e.translationX < 0 ? 1 : -1); return; }
      const current = drag.current;
      if (!current) return;
      current.released = true;
      if (current.destination) settle(current, commit);
      else if (!commit) clear();
    },
  });
  const travel = (preview?.step ?? 1) * width;
  const activeStyle = !preview ? undefined : slide
    ? { transform: [{ translateX: Animated.multiply(progress, -travel) }] }
    : { opacity: Animated.subtract(1, progress) };
  const previewStyle = slide
    ? { transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [travel, 0] }) }] }
    : { opacity: progress };
  return { pan, preview, activeStyle, previewStyle, cancel: clear, suppressTap: () => Date.now() - lastSwipe.current < 150 };
}
