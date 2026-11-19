import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { Section, SegmentedControl, PrimaryButton } from '@/components/ui/controls';
import { useSettings } from '@/features/settings/SettingsProvider';
import { importDocument } from './importer';
import { SettingKeys, type ImportMethod } from '@/lib/settingsKeys';

const SCAN_URI_KEY = 'sirum.scanFolderUri';
const ACCEPTED_EXT = ['txt', 'epub', 'pdf'];

interface ScanFile {
  name: string;
  path: string;
  ext: string;
  selected: boolean;
}

interface ScanState {
  files: ScanFile[];
  done: boolean;
}

/** Recursively collect candidate files under a SAF directory URI. */
async function scanTree(uri: string, depth = 0): Promise<ScanFile[]> {
  if (depth > 6) return [];
  let entries: string[] = [];
  try {
    entries = await FileSystem.StorageAccessFramework.readDirectoryAsync(uri);
  } catch {
    return [];
  }
  const out: ScanFile[] = [];
  for (const itemUri of entries) {
    // Probing with the item's own URI determines whether it's a directory
    const isDir = await FileSystem.StorageAccessFramework.readDirectoryAsync(itemUri)
      .then(() => true)
      .catch(() => false);
    if (isDir) {
      out.push(...(await scanTree(itemUri, depth + 1)));
    } else {
      const decoded = decodeURIComponent(itemUri);
      const rawName = decoded.split('/').pop()?.split(':').pop() || 'book';
      const ext = rawName.includes('.') ? rawName.split('.').pop()!.toLowerCase() : '';
      if (ACCEPTED_EXT.includes(ext)) {
        out.push({ name: rawName, path: itemUri, ext, selected: true });
      }
    }
  }
  return out;
}

export default function ImportScreen() {
  const { get, set } = useSettings();
  const { toast } = useChrome();
  const navMode = get(SettingKeys.deviceNavMode);
  const method = get(SettingKeys.deviceImportMethod);

  const [tab, setTab] = useState<ImportMethod>(method);
  const [scanUri, setScanUri] = useState<string | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SCAN_URI_KEY)
      .then((v) => setScanUri(v))
      .catch(() => {});
  }, []);

  const pushLog = (line: string) => setLog((l) => [...l, line]);

  const requestAccess = useCallback(async () => {
    if (Platform.OS !== 'android') return;
    try {
      const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (!res.granted) return;
      await AsyncStorage.setItem(SCAN_URI_KEY, res.directoryUri);
      setScanUri(res.directoryUri);
      toast('Storage access granted');
    } catch {
      toast('Could not get storage access');
    }
  }, [toast]);

  const revokeAccess = useCallback(async () => {
    await AsyncStorage.removeItem(SCAN_URI_KEY);
    setScanUri(null);
    setScan(null);
    toast('Storage access revoked');
  }, [toast]);

  const runScan = useCallback(async () => {
    if (!scanUri) {
      await requestAccess();
      return;
    }
    setScan({ files: [], done: false });
    const files = await scanTree(scanUri);
    setScan({ files, done: true });
  }, [scanUri, requestAccess]);

  const addScanned = useCallback(async () => {
    if (!scan) return;
    const chosen = scan.files.filter((f) => f.selected);
    setBusy(true);
    let added = 0;
    for (const f of chosen) {
      const result = await importDocument({ uri: f.path, name: f.name });
      if (result.status === 'added') added++;
      pushLog(
        result.status === 'added'
          ? `Added ${result.title}`
          : result.status === 'duplicate'
            ? `Skipped ${f.name} (already in library)`
            : `${f.name}: ${result.reason}`
      );
    }
    setScan(null);
    setBusy(false);
    toast(`Added ${added} book${added === 1 ? '' : 's'}`);
  }, [scan, toast]);

  const pickFiles = useCallback(async () => {
    setBusy(true);
    try {
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
      if (res.canceled) return;
      let added = 0;
      for (const asset of res.assets) {
        const result = await importDocument({
          uri: asset.uri,
          name: asset.name,
          size: asset.size,
        });
        if (result.status === 'added') added++;
        pushLog(
          result.status === 'added'
            ? `Added ${result.title}`
            : result.status === 'duplicate'
              ? `Skipped ${asset.name} (already in library)`
              : `${asset.name}: ${result.reason}`
        );
      }
      toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    } catch {
      toast('Could not open the file picker');
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const scanSupported = Platform.OS === 'android';
  const effectiveTab: ImportMethod = scanSupported ? tab : 'manual';

  return (
    <Screen>
      <AppBar title="Import" leading={navMode === 'side' ? 'menu' : 'none'} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        {scanSupported && (
          <View className="mb-3">
            <SegmentedControl<ImportMethod>
              options={[
                ['scan', 'Scan device'],
                ['manual', 'Manual import'],
              ]}
              value={effectiveTab}
              onChange={async (v) => {
                setTab(v);
                await set(SettingKeys.deviceImportMethod, v);
              }}
            />
          </View>
        )}

        {effectiveTab === 'scan' ? (
          <>
            <Section
              title={`Storage access: ${scanUri ? 'granted' : 'not granted'}`}
              description="Sirum looks for .txt, .epub and .pdf files in the folder you allow. Your files stay on this device.">
              <PrimaryButton
                label={scanUri ? 'Scan now' : 'Allow access and scan'}
                onPress={runScan}
                disabled={busy}
              />
              {scanUri && (
                <PrimaryButton label="Revoke access" ghost onPress={revokeAccess} />
              )}
            </Section>

            {scan && (
              <Section title={scan.done ? `Found ${scan.files.length} files` : 'Scanning…'}>
                {scan.files.map((f, i) => (
                  <Pressable
                    key={f.path}
                    className="flex-row items-center gap-3 py-2"
                    onPress={() =>
                      setScan((s) =>
                        s
                          ? {
                              ...s,
                              files: s.files.map((x, j) =>
                                j === i ? { ...x, selected: !x.selected } : x
                              ),
                            }
                          : s
                      )
                    }>
                    <View
                      className="w-5 h-5 rounded border items-center justify-center"
                      style={{
                        borderColor: 'rgb(var(--ln))',
                        backgroundColor: f.selected ? 'rgb(var(--ac))' : 'transparent',
                      }}>
                      {f.selected && <Text className="font-ui text-bg text-[12px] font-bold">✓</Text>}
                    </View>
                    <View className="flex-1 min-w-0">
                      <Text numberOfLines={1} className="font-ui text-tx font-medium">
                        {f.name}
                      </Text>
                      <Text numberOfLines={1} className="font-ui text-mu text-[13px]">
                        {f.path}
                      </Text>
                    </View>
                    <Text className="font-ui text-mu text-[13px] uppercase">{f.ext}</Text>
                  </Pressable>
                ))}
                {scan.done && scan.files.length > 0 && (
                  <PrimaryButton
                    label={`Add ${scan.files.filter((f) => f.selected).length} selected`}
                    onPress={addScanned}
                    disabled={busy}
                  />
                )}
              </Section>
            )}
          </>
        ) : (
          <Section
            title="Choose files"
            description="Opens the system file picker. No storage permission needed.">
            <PrimaryButton label="Choose files" onPress={pickFiles} disabled={busy} />
          </Section>
        )}

        {log.length > 0 && (
          <View className="mt-2">
            {log.map((line, i) => (
              <Text key={i} className="font-ui text-mu text-[13px]">
                {line}
              </Text>
            ))}
          </View>
        )}
      </ScrollView>
    </Screen>
  );
}
