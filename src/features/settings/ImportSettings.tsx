import * as FileSystem from 'expo-file-system/legacy';
import React, { useCallback, useEffect, useState } from 'react';
import { Platform, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { Section, SegmentedControl, PrimaryButton } from '@/components/ui/controls';
import { useChrome } from '@/components/chrome/app-bar';
import { SettingKeys, type ImportMethod } from '@/lib/settingsKeys';
import { useSettings } from './SettingsProvider';
import { SettingsPage } from './SettingsPage';

const SCAN_URI_KEY = 'sirum.scanFolderUri';

export default function ImportSettings() {
  const { get, set } = useSettings();
  const { toast } = useChrome();
  const [scanUri, setScanUri] = useState<string | null>(null);
  const scanSupported = Platform.OS === 'android';

  useEffect(() => {
    AsyncStorage.getItem(SCAN_URI_KEY).then(setScanUri).catch(() => {});
  }, []);

  const requestAccess = useCallback(async () => {
    try {
      const res = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
      if (res.granted) {
        await AsyncStorage.setItem(SCAN_URI_KEY, res.directoryUri);
        setScanUri(res.directoryUri);
        toast('Storage access granted');
      }
    } catch {
      toast('Could not get storage access');
    }
  }, [toast]);

  const revokeAccess = useCallback(async () => {
    await AsyncStorage.removeItem(SCAN_URI_KEY);
    setScanUri(null);
    toast('Storage access revoked');
  }, [toast]);

  return (
    <SettingsPage title="Import and storage">
      {scanSupported && (
        <Section title="Import method" description="How you add files to your library.">
          <SegmentedControl<ImportMethod>
            options={[
              ['scan', 'Scan device'],
              ['manual', 'Manual import'],
            ]}
            value={get(SettingKeys.deviceImportMethod)}
            onChange={(v) => set(SettingKeys.deviceImportMethod, v)}
          />
        </Section>
      )}
      <Section
        title="Storage access"
        description={
          scanSupported
            ? `Status: ${scanUri ? 'granted' : 'not granted'}. On Android this is a folder you pick.`
            : 'iOS has no folder scan, so use manual import.'
        }>
        {scanSupported ? (
          <PrimaryButton
            label={scanUri ? 'Revoke access' : 'Allow storage access'}
            ghost={!!scanUri}
            onPress={scanUri ? revokeAccess : requestAccess}
          />
        ) : (
          <Text className="font-ui text-mu text-[13px]">Manual import is the only option on iOS.</Text>
        )}
      </Section>
    </SettingsPage>
  );
}
