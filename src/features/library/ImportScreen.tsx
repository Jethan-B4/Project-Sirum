import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Pressable, ScrollView, Share, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { AppBar, Screen, useChrome } from '@/components/chrome/app-bar';
import { Section, SegmentedControl, PrimaryButton } from '@/components/ui/controls';
import { useSettings } from '@/features/settings/SettingsProvider';
import { importDocument, type ImportResult } from './importer';
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
  done: boolean;
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
  const decoded = decodeURIComponent(uri);
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
  errors: string[]
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
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(SCAN_URI_KEY)
      .then((v) => setScanUri(v))
      .catch(() => {});
  }, []);

  const record = useCallback((item: RunItem) => {
    setRun((r) => [...(r ?? []), item]);
  }, []);

  const importOne = useCallback(
    async (uri: string, name: string, size?: number | null) => {
      const result = await importDocument({ uri, name, size });
      record({
        name,
        uri,
        status: result.status,
        reason:
          result.status === 'unsupported' || result.status === 'error'
            ? result.reason
            : result.status === 'duplicate'
              ? `Already in your library (${result.title})`
              : undefined,
        documentId: result.status === 'duplicate' ? result.documentId : undefined,
      });
      return result.status === 'added';
    },
    [record]
  );

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
    setScan({ files: [], done: false, errors: [] });
    const errors: string[] = [];
    const files = await scanTree(scanUri, 0, new Set(), errors);
    setScan({ files, done: true, errors });
  }, [scanUri, requestAccess]);

  const addScanned = useCallback(async () => {
    if (!scan) return;
    const chosen = scan.files.filter((f) => f.selected);
    setBusy(true);
    setRun([]);
    let added = 0;
    for (const f of chosen) {
      if (await importOne(f.path, f.name)) added++;
    }
    setScan(null);
    setBusy(false);
    toast(`Added ${added} book${added === 1 ? '' : 's'}`);
  }, [scan, importOne, toast]);

  const pickFiles = useCallback(async () => {
    setBusy(true);
    setRun([]);
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
      if (res.canceled) {
        setRun(null);
        return;
      }
      let added = 0;
      for (const asset of res.assets) {
        if (await importOne(asset.uri, asset.name, asset.size)) added++;
      }
      toast(`Added ${added} book${added === 1 ? '' : 's'}`);
    } catch {
      toast('Could not open the file picker');
    } finally {
      setBusy(false);
    }
  }, [importOne, toast]);

  /** Re-run only the files that errored in the last run. */
  const retryFailed = useCallback(async () => {
    if (!run) return;
    const failed = run.filter((r) => r.status === 'error');
    if (failed.length === 0) return;
    setBusy(true);
    setRun([]);
    let added = 0;
    for (const f of failed) {
      if (await importOne(f.uri, f.name)) added++;
    }
    setBusy(false);
    toast(`Retried ${failed.length}: added ${added}`);
  }, [run, importOne, toast]);

  const copyReport = useCallback(async () => {
    if (!run || run.length === 0) return;
    const counts = { added: 0, duplicate: 0, unsupported: 0, error: 0 };
    for (const r of run) counts[r.status]++;
    const lines = [
      `Sirum import report — ${run.length} file${run.length === 1 ? '' : 's'}`,
      `Imported: ${counts.added} · Duplicates: ${counts.duplicate} · Skipped: ${counts.unsupported} · Failed: ${counts.error}`,
      '',
      ...run.map((r) =>
        r.reason ? `${r.name}: ${RESULT_LABEL[r.status]} — ${r.reason}` : `${r.name}: ${RESULT_LABEL[r.status]}`
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
                {scan.errors.map((e, i) => (
                  <Text key={i} className="font-ui text-mu text-[13px] mb-1">
                    {e}
                  </Text>
                ))}
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

        {/* Import report: counts + per-file reasons (plan 5.1.1) */}
        {run && run.length > 0 && counts && (
          <Section
            title={`${run.length} file${run.length === 1 ? '' : 's'} — ${counts.added} imported, ${counts.duplicate} duplicates, ${counts.skipped} skipped, ${counts.failed} failed`}>
            {run.map((r, i) => (
              <View key={`${r.name}-${i}`} className="flex-row items-start gap-2 py-1.5">
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
                    style={{ backgroundColor: 'rgb(var(--acb))' }}>
                    <Text className="font-ui text-accent text-[12px] font-semibold">Open</Text>
                  </Pressable>
                )}
              </View>
            ))}
            <View className="flex-row gap-2 mt-2">
              {failedItems.length > 0 && (
                <PrimaryButton label={`Retry failed (${failedItems.length})`} onPress={retryFailed} disabled={busy} />
              )}
              <PrimaryButton label="Copy report" ghost onPress={copyReport} />
            </View>
          </Section>
        )}
      </ScrollView>
    </Screen>
  );
}
