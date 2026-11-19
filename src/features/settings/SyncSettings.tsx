import React from 'react';
import { Text } from 'react-native';

import { Section, PrimaryButton } from '@/components/ui/controls';
import { useAuth } from '@/auth/session';
import { SettingsPage } from './SettingsPage';

/**
 * Sync settings. Google sign-in ships in Phase 5 (needs an EAS development
 * build); until then the account section explains the state and the button
 * stays disabled, matching the prototype.
 */
export default function SyncSettings() {
  const { session, signOut } = useAuth();
  const email = session?.user?.email;

  return (
    <SettingsPage title="Sync">
      <Section
        title="Account"
        description={
          email
            ? `Signed in as ${email}. Progress, bookmarks, highlights, notes and settings sync across your devices. Book files stay on each device.`
            : 'You are not signed in. Reading works fully offline. Sign in with Google to sync progress, bookmarks and settings. Only metadata syncs; book files stay on this device.'
        }>
        {email ? (
          <PrimaryButton label="Sign out" ghost onPress={() => signOut()} />
        ) : (
          <PrimaryButton label="Sign in with Google" disabled />
        )}
        <Text className="font-ui text-mu text-[13px] mt-2">
          Sync status: {session ? 'signed in' : 'local only'} · last sync —
        </Text>
      </Section>
    </SettingsPage>
  );
}
