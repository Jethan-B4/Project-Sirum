import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  Share,
  Text,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@/components/ui/icon';
import { contrastText } from '@/lib/color';
import { useAppTheme } from '@/theme/ThemeProvider';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { Section, SegmentedControl, PrimaryButton } from '@/components/ui/controls';
import { useSettings } from '@/features/settings/SettingsProvider';
import { importDocument, type ImportResult, type PickedFile } from './importer';
import { SettingKeys, type ImportMethod } from '@/lib/settingsKeys';

const SCAN_URI_KEY = 'sirum.scanFolderUri';
const ACCEPTED_RE = /\.(txt|epub|pdf)$/i;
const MAX_DEPTH = 12;

interface ScanFile {
  name: string;
  path: string;
  ext: string;
  selected: boolean;
}

interface ScanState {
  files: ScanFile[];
  errors: string[];
}

/** One file's outcome within an import run (plan 5.1.1 ImportReport). */
interface RunItem {
  name: string;
  uri: string;
  status: ImportResult['status'];
  reason?: string;
  documentId?: string;
}

/** File name from a (possibly percent-encoded) SAF/document URI. */
function nameFromUri(uri: string): string {
  let decoded = uri;
  try {
    decoded = decodeURIComponent(uri);
  } catch {
    /* Provider supplied an unescaped file name. */
  }
  const raw = decoded.split('/').pop()?.split(':').pop() || 'book';
  return raw;
}

/**
 * Recursively collect candidate files under a SAF directory URI.
 * Case-insensitive extension match on the decoded name (SAF URIs percent-encode
 * '/' as %2F, and providers report inconsistent MIME types). A visited set
 * guards against loops; unreadable folders are recorded, not silently skipped.
 */
async function scanTree(
  uri: string,
  depth: number,
  visited: Set<string>,
  errors: string[],
): Promise<ScanFile[]> {
  if (depth > MAX_DEPTH || visited.has(uri)) return [];
  visited.add(uri);
  let entries: string[] = [];
  try {
    entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(uri);
  } catch {
    errors.push(`Could not read a folder (${nameFromUri(uri)})`);
    return [];
  }
  const out: ScanFile[] = [];
  for (const itemUri of entries) {
    // Probing with the item's own URI determines whether it's a directory
    const isDir = await FileSystem.StorageAccessFramework.readDirectoryAsync(itemUri)
      .then(() => true)
      .catch(() => false);
    if (isDir) {
      out.push(...(await scanTree(itemUri, depth + 1, visited, errors)));
    } else {
      const rawName = nameFromUri(itemUri);
      const m = rawName.match(ACCEPTED_RE);
      if (m) {
        out.push({
          name: rawName,
          path: itemUri,
          ext: m[1].toLowerCase(),
          selected: true,
        });
      }
    }
  }
  return out;
}

const RESULT_LABEL: Record<RunItem['status'], string> = {
  added: 'Imported',
  duplicate: 'Duplicate',
  unsupported: 'Skipped',
  error: 'Failed',
};

export default function ImportScreen() {
  const router = useRouter();
  const { get, set } = useSettings();
  const { toast } = useChrome();
  const navMode = get(SettingKeys.deviceNavMode);
  const method = get(SettingKeys.deviceImportMethod);

  const [tab, setTab] = useState<ImportMethod>(method);
  const [scanUri, setScanUri] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [run, setRun] = useState<RunItem[] | null>(null);
  const [activity, setActivity] = useState('');
  const locked = useRef(false);
  const busy = activity.length > 0;
  const { accent } = useAppTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    AsyncStorage.getItem(SCAN_URI_KEY)
      .then((v) => setScanUri(v))
      .catch(() => {});
  }, []);

  async function perform(label: string, task: () => Promise<void>) {
    if (locked.current) return;
    locked.current = true;
    setActivity(label);
    try {
      await task();
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Operation could not finish');
    } finally {
      locked.current = false;
      setActivity('');
    }
  }

  async function revokeAccess() {
    await perform('Updating folder access�', async () => {
      await AsyncStorage.removeItem(SCAN_URI_KEY);
      setScanUri(null);
      setScan(null);
      toast('Storage access revoked');
    });
  }

  async function runScan() {
    await perform('Scanning folder�', async () => {
      let folder = scanUri;
      if (!folder) {
        const result = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
        if (!result.granted) return;
        folder = result.directoryUri;
        await AsyncStorage.setItem(SCAN_URI_KEY, folder);
        setScanUri(folder);
      }
      setRun(null);
      setScan(null);
      const errors: string[] = [];
      const files = await scanTree(folder, 0, new Set(), errors);
      setScan({ files, errors });
    });
  }

  async function importFiles(files: PickedFile[]) {
    const items: RunItem[] = [];
    setRun(null);
    for (const [index, file] of files.entries()) {
      setActivity('Importing ' + (index + 1) + ' of ' + files.length + ' � ' + file.name);
      try {
        const result = await importDocument(file);
        items.push({
          name: file.name,
          uri: file.uri,
          status: result.status,
          reason:
            'reason' in result
              ? result.reason
              : result.status === 'duplicate'
                ? 'Already in your library (' + result.title + ')'
                : undefined,
          documentId: result.status === 'duplicate' ? result.documentId : undefined,
        });
      } catch (error) {
        items.push({
          name: file.name,
          uri: file.uri,
          status: 'error',
          reason: error instanceof Error ? error.message : 'Could not import file',
        });
      }
    }
    setScan(null);
    setRun(items);
    const added = items.filter((item) => item.status === 'added').length;
    toast('Added ' + added + (added === 1 ? ' book' : ' books'));
  }

  async function pickFiles() {
    await perform('Choosing files�', async () => {
      const res = await DocumentPicker.getDocumentAsync({
        type: [
          'text/plain',
          'application/epub+zip',
          'application/pdf',
          'application/octet-stream',
          'application/zip',
          '*/*',
        ],
        copyToCacheDirectory: true,
        multiple: true,
      });
      if (!res.canceled) await importFiles(res.assets);
    });
  }

  const copyReport = useCallback(async () => {
    if (!run || run.length === 0) return;
    const counts = { added: 0, duplicate: 0, unsupported: 0, error: 0 };
    for (const r of run) counts[r.status]++;
    const lines = [
      `Sirum import report — ${run.length} file${run.length === 1 ? '' : 's'}`,
      `Imported: ${counts.added} · Duplicates: ${counts.duplicate} · Skipped: ${counts.unsupported} · Failed: ${counts.error}`,
      '',
      ...run.map((r) =>
        r.reason
          ? `${r.name}: ${RESULT_LABEL[r.status]} — ${r.reason}`
          : `${r.name}: ${RESULT_LABEL[r.status]}`,
      ),
    ];
    try {
      await Share.share({ message: lines.join('\n') });
    } catch {
      toast('Could not share the report');
    }
  }, [run, toast]);

  const counts = run
    ? {
        added: run.filter((r) => r.status === 'added').length,
        duplicate: run.filter((r) => r.status === 'duplicate').length,
        skipped: run.filter((r) => r.status === 'unsupported').length,
        failed: run.filter((r) => r.status === 'error').length,
      }
    : null;
  const failedItems = run?.filter((r) => r.status === 'error') ?? [];

  const scanSupported = Platform.OS === 'android';
  const effectiveTab: ImportMethod = scanSupported ? tab : 'manual';

  const reviewing = effectiveTab === 'scan' && scan != null;
  const selected = scan?.files.filter((file) => file.selected) ?? [];
  const footerPadding = navMode === 'side' ? Math.max(insets.bottom, 12) : 12;

  return (
    <Screen>
      <AppBar title="Import" leading={navMode === 'side' ? 'menu' : 'none'} />
      <View className="flex-1 px-3 pt-2" style={{ paddingBottom: footerPadding }}>
        {scanSupported && (
          <View className="mb-3">
            <SegmentedControl<ImportMethod>
              options={[
                ['scan', 'Scan device'],
                ['manual', 'Manual import'],
              ]}
              disabled={busy}
              value={effectiveTab}
              onChange={async (v) => {
                if (v === tab) return;
                setTab(v);
                setRun(null);
                await set(SettingKeys.deviceImportMethod, v);
              }}
            />
          </View>
        )}

        {busy && (
          <View
            accessibilityLiveRegion="polite"
            className="flex-row items-center gap-3 rounded-xl bg-surface px-4 py-3 mb-2"
          >
            <ActivityIndicator color={accent.hex} />
            <Text numberOfLines={2} className="flex-1 font-ui text-tx text-sm">
              {activity}
            </Text>
          </View>
        )}

        {reviewing ? (
          <>
            <View className="flex-row items-center justify-between gap-3 mb-1">
              <Text className="flex-1 font-ui text-tx text-base font-semibold">
                Scanned books ({scan.files.length})
              </Text>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() => setScan(null)}
                className="py-3 px-2"
              >
                <Text className="font-ui text-accent font-semibold">Close</Text>
              </Pressable>
            </View>
            <FlatList
              style={{ flex: 1 }}
              className="rounded-xl bg-surface"
              data={scan.files}
              keyExtractor={(file) => file.path}
              ListHeaderComponent={
                scan.errors.length ? (
                  <Text className="font-ui text-mu px-4 py-2">{scan.errors.join('\n')}</Text>
                ) : undefined
              }
              ListEmptyComponent={
                <Text className="font-ui text-mu p-4">
                  No supported books found in this folder.
                </Text>
              }
              renderItem={({ item, index }) => (
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityLabel={item.name}
                  accessibilityState={{ checked: item.selected, disabled: busy }}
                  disabled={busy}
                  className="flex-row items-center gap-3 px-4 py-3 border-b border-line"
                  onPress={() =>
                    setScan((previous) => {
                      if (!previous) return previous;
                      const files = previous.files.slice();
                      files[index] = { ...files[index], selected: !files[index].selected };
                      return { ...previous, files };
                    })
                  }
                >
                  <Icon
                    name={item.selected ? 'checkbox' : 'square-outline'}
                    tone={item.selected ? 'accent' : 'muted'}
                    size={22}
                  />
                  <View className="flex-1">
                    <Text numberOfLines={2} className="font-ui text-tx font-medium">
                      {item.name}
                    </Text>
                    <Text
                      numberOfLines={1}
                      ellipsizeMode="middle"
                      className="font-ui text-mu text-xs"
                    >
                      {item.path}
                    </Text>
                  </View>
                  <Text className="font-ui text-mu text-xs uppercase">{item.ext}</Text>
                </Pressable>
              )}
            />
            <View className="flex-row items-center justify-between gap-2 pt-2">
              <Text className="font-ui text-mu flex-1">{selected.length} selected</Text>
              <PrimaryButton
                label="Add to library"
                disabled={busy || !selected.length}
                onPress={() =>
                  perform('Importing books�', () =>
                    importFiles(selected.map((file) => ({ uri: file.path, name: file.name }))),
                  )
                }
              />
            </View>
          </>
        ) : run?.length && counts ? (
          <>
            <Text className="font-ui text-tx text-base font-semibold">Import results</Text>
            <Text className="font-ui text-mu text-sm my-2">
              {counts.added} imported � {counts.duplicate} duplicates � {counts.skipped} skipped �{' '}
              {counts.failed} failed
            </Text>
            <FlatList
              style={{ flex: 1 }}
              data={run}
              keyExtractor={(item, index) => item.uri + index}
              renderItem={({ item: r }) => (
                <View className="flex-row items-start gap-2 py-1.5">
                  <Text className="font-ui text-mu text-[13px] w-20" numberOfLines={1}>
                    {RESULT_LABEL[r.status]}
                  </Text>
                  <View className="flex-1 min-w-0">
                    <Text numberOfLines={1} className="font-ui text-tx text-[13px] font-medium">
                      {r.name}
                    </Text>
                    {!!r.reason && (
                      <Text numberOfLines={2} className="font-ui text-mu text-[12px]">
                        {r.reason}
                      </Text>
                    )}
                  </View>
                  {r.status === 'duplicate' && r.documentId && (
                    <Pressable
                      onPress={() => router.push(`/reader/${r.documentId}` as never)}
                      className="px-2 py-1 rounded-full"
                      style={{ backgroundColor: accent.hexStrong }}
                    >
                      <Text
                        className="font-ui text-[12px] font-semibold"
                        style={{ color: contrastText(accent.hexStrong) }}>
                        Open
                      </Text>
                    </Pressable>
                  )}
                </View>
              )}
            />
            <View className="flex-row flex-wrap gap-2 pt-2">
              {failedItems.length > 0 && (
                <PrimaryButton
                  label="Retry failed"
                  disabled={busy}
                  onPress={() => perform('Retrying files�', () => importFiles(failedItems))}
                />
              )}
              <PrimaryButton label="Copy report" ghost onPress={copyReport} />
              <PrimaryButton label="Done" ghost onPress={() => setRun(null)} />
            </View>
          </>
        ) : (
          <ScrollView style={{ flex: 1 }}>
            {effectiveTab === 'scan' ? (
              <Section
                title={scanUri ? 'Scan folder' : 'Choose a folder'}
                description="Scan a folder for TXT, EPUB and PDF files."
              >
                <PrimaryButton
                  label={scanUri ? 'Scan now' : 'Allow access and scan'}
                  onPress={runScan}
                  disabled={busy}
                />
                {scanUri && (
                  <PrimaryButton
                    label="Revoke access"
                    ghost
                    onPress={revokeAccess}
                    disabled={busy}
                  />
                )}
              </Section>
            ) : (
              <Section title="Choose files" description="Import from the system file picker.">
                <PrimaryButton label="Choose files" onPress={pickFiles} disabled={busy} />
              </Section>
            )}
          </ScrollView>
        )}
      </View>
    </Screen>
  );
}
