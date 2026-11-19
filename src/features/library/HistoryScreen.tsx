import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ScrollView, Text } from 'react-native';

import { AppBar, Screen } from '@/components/chrome/app-bar';
import { BookRow } from '@/components/ui/book';
import { documents, type LibraryDocument } from '@/db/repositories/documents';
import { useSettings } from '@/features/settings/SettingsProvider';
import { SettingKeys } from '@/lib/settingsKeys';

/** History: books with any reading progress, most recently read first. */
export default function HistoryScreen() {
  const router = useRouter();
  const { get } = useSettings();
  const navMode = get(SettingKeys.deviceNavMode);
  const [books, setBooks] = useState<LibraryDocument[]>([]);

  useFocusEffect(
    useCallback(() => {
      documents
        .list({ orderMode: 'fixed', sort: 'lastRead', sortDirection: 'desc' })
        .then((rows) => setBooks(rows.filter((b) => (b.percent ?? 0) > 0)))
        .catch((e) => console.error('History load failed', e));
    }, [])
  );

  return (
    <Screen>
      <AppBar title="History" leading={navMode === 'side' ? 'menu' : 'none'} />
      <ScrollView contentContainerStyle={{ padding: 12, paddingBottom: 24 }}>
        {books.length === 0 ? (
          <Text className="font-ui text-mu text-center mt-10">Nothing read yet.</Text>
        ) : (
          books.map((b) => (
            <BookRow
              key={b.id}
              book={b}
              onPress={(book) => {
                if (book.local_uri == null) return;
                documents.touchOpened(book.id).catch(() => {});
                router.push(`/reader/${book.id}` as never);
              }}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
