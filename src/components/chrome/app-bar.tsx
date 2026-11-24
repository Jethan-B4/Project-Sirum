import { usePathname, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton, type IconName } from '@/components/ui/icon';
import { useSettings } from '@/features/settings/SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';
import { contrastText } from '@/lib/color';
import { useAppTheme } from '@/theme/ThemeProvider';

/** Top app bar (prototype `.bar`): optional leading control, title + count pill, actions. */
export function AppBar({
  compact = false,
  title,
  count,
  leading,
  actions,
  customAction,
}: {
  compact?: boolean;
  title: React.ReactNode;
  count?: number;
  leading?: 'menu' | 'back' | 'none';
  actions?: { icon: IconName; label: string; onPress: () => void }[];
  /** Arbitrary trailing control (e.g. the reader's "Aa" button). */
  customAction?: React.ReactNode;
}) {
  const router = useRouter();
  const showMenu = leading === 'menu';

  return (
    <View className={compact ? 'flex-row items-center gap-1 py-0.5 px-2' : 'flex-row items-center gap-1 pt-3 pb-2 px-3'}>
      {leading === 'back' && (
        <IconButton icon="arrow-back" label="Back" onPress={() => router.back()} />
      )}
      {showMenu && <MenuButton />}
      <View className="flex-1 min-w-0 flex-row items-center gap-2.5">
        {typeof title === 'string' ? (
          <Text className="font-ui text-tx text-[22px] font-semibold flex-shrink" numberOfLines={1}>
            {title}
          </Text>
        ) : (
          title
        )}
        {count !== undefined && (
          <View className="bg-surface-2 rounded-2xl px-2.5 py-0.5">
            <Text className="font-ui text-[13px] font-medium text-tx">{count}</Text>
          </View>
        )}
      </View>
      {actions?.map((a) => (
        <IconButton key={a.label} icon={a.icon} label={a.label} onPress={a.onPress} />
      ))}
      {customAction}
    </View>
  );
}

function MenuButton() {
  const { openDrawer } = useChrome();
  return <IconButton icon="menu" label="Menu" onPress={openDrawer} />;
}

// --- Bottom navigation (prototype `.bn`) ------------------------------------

const NAV_ITEMS: { route: string; label: string; icon: IconName }[] = [
  { route: '/', label: 'Library', icon: 'library' },
  { route: '/history', label: 'History', icon: 'time-outline' },
  { route: '/import', label: 'Import', icon: 'add' },
  { route: '/settings', label: 'Settings', icon: 'settings-outline' },
];

export function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();

  const active =
    pathname === '/' || pathname === '/index'
      ? '/'
      : pathname.startsWith('/settings')
        ? '/settings'
        : pathname;

  return (
    <View
      className="bg-surface border-t border-line pt-2.5"
      style={{ paddingBottom: Math.max(insets.bottom, 8) + 6 }}>
      <View className="flex-row">
        {NAV_ITEMS.map((item) => {
          const on = active === item.route;
          return (
            <Pressable
              key={item.route}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              accessibilityState={{ selected: on }}
              onPress={() => router.navigate(item.route as never)}
              className="flex-1 items-center">
              <View
                className="px-5 py-1 rounded-2xl mb-0.5"
                style={on ? { backgroundColor: accent.acb } : undefined}>
                <Icon name={item.icon} size={22} tone={on ? contrastText(accent.acb) : 'muted'} />
              </View>
              <Text
                className={`font-ui text-[12px] ${on ? '' : 'text-mu'}`}
                style={on ? { color: accent.hex } : undefined}>
                {item.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// --- Chrome context (drawer + toast live at the root) ------------------------

interface ChromeContextValue {
  openDrawer(): void;
  toast(message: string): void;
}

const ChromeContext = React.createContext<ChromeContextValue>({
  openDrawer: () => {},
  toast: () => {},
});

export function useChrome(): ChromeContextValue {
  return React.useContext(ChromeContext);
}

export function ChromeProvider({ children }: { children: React.ReactNode }) {
  const [drawerOpen, setDrawerOpen] = React.useState(false);
  const [toastMsg, setToastMsg] = React.useState<string | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const toast = React.useCallback((message: string) => {
    setToastMsg(message);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setToastMsg(null), 2200);
  }, []);

  React.useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <ChromeContext.Provider value={{ openDrawer: () => setDrawerOpen(true), toast }}>
      {children}
      <SideDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {toastMsg ? (
        <View className="absolute left-4 right-4 bottom-20 z-10">
          <View className="bg-[#e8e8ec] rounded-xl px-4 py-3">
            <Text className="font-ui text-[#111111]">{toastMsg}</Text>
          </View>
        </View>
      ) : null}
    </ChromeContext.Provider>
  );
}

// --- Side drawer (prototype `.dr`) -------------------------------------------

function SideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { accent } = useAppTheme();

  if (!open) return null;

  const go = (route: string, tab?: string) => {
    onClose();
    if (tab) {
      // Format tabs live on the library screen; pass via params.
      router.navigate({ pathname: '/', params: { tab } } as never);
    } else {
      router.navigate(route as never);
    }
  };

  const onLibrary = pathname === '/' || pathname === '/index';

  const item = (
    icon: IconName,
    label: string,
    onPress: () => void,
    activeItem?: boolean
  ) => (
    <Pressable
      key={label}
      accessibilityRole="button"
      onPress={onPress}
      className="flex-row items-center gap-5 px-5 py-3.5"
      style={activeItem ? { backgroundColor: accent.acb } : undefined}>
      <Icon name={icon} size={22} tone={activeItem ? contrastText(accent.acb) : 'default'} />
      <Text
        className="font-ui text-base text-tx"
        style={activeItem ? { color: contrastText(accent.acb) } : undefined}>
        {label}
      </Text>
    </Pressable>
  );

  // Format-tab highlighting is handled by the library screen itself.
  const formatActive = (_f: string) => false;

  return (
    <View className="absolute inset-0 z-20">
      <Pressable className="absolute inset-0 bg-black/55" onPress={onClose} />
      <View
        className="absolute top-0 bottom-0 left-0 w-[78%] max-w-[320px] bg-surface"
        style={{ paddingTop: insets.top }}>
        <ScrollView>
          <Text className="font-ui text-tx text-[22px] font-semibold px-5 pt-5 pb-4">Sirum</Text>
          {item('library', 'My books', () => go('/'), onLibrary)}
          <Text className="font-ui text-mu text-sm px-5 pt-4 pb-1">Formats</Text>
          {(['epub', 'txt', 'pdf'] as const).map((f) =>
            item('book', f.toUpperCase(), () => go('/', f), formatActive(f))
          )}
          <View className="border-t border-line my-2" />
          {item('time-outline', 'History', () => go('/history'), pathname === '/history')}
          {item('add', 'Import', () => go('/import'), pathname === '/import')}
          {item('settings-outline', 'Settings', () => go('/settings'), pathname.startsWith('/settings'))}
        </ScrollView>
      </View>
    </View>
  );
}

// --- Screen wrapper -----------------------------------------------------------

/**
 * Standard screen chrome: top safe-area padding, optional bottom tab bar.
 * Screens render their own AppBar and content inside.
 */
export function Screen({
  children,
  showNav = true,
}: {
  children: React.ReactNode;
  /** Reader hides the nav (prototype behavior). */
  showNav?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { get } = useSettings();
  const navMode = get(SettingKeys.deviceNavMode);

  return (
    <View className="flex-1 bg-bg" style={{ paddingLeft: insets.left, paddingRight: insets.right, paddingBottom: !showNav || navMode === 'side' ? insets.bottom : 0 }}>
      <View style={{ flex: 1, paddingTop: insets.top }}>{children}</View>
      {showNav && navMode === 'bottom' && <BottomNav />}
    </View>
  );
}
