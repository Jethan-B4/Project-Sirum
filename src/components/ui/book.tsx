import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { LibraryDocument } from '@/db/repositories/documents';
import { SettingKeys } from '@/lib/settingsKeys';
import { useSettings } from '@/features/settings/SettingsProvider';
import { useAppTheme } from '@/theme/ThemeProvider';
import { pressFeedback } from './press-feedback';

/** Cover frame ratio (2:3). Art within ±8% of this fills the frame; anything else is shown whole. */
const FRAME_RATIO = 2 / 3;
const FRAME_RATIO_TOLERANCE = 0.08;

// Curated luxury book cover palette for titles without cover art
const COVER_PALETTES: [string, string][] = [
  ['#1e293b', '#0f172a'], // Deep Slate / Midnight
  ['#1e3a5f', '#0c1b33'], // Oxford Blue
  ['#14453d', '#08231e'], // Deep Emerald
  ['#581c2d', '#2b0b14'], // Burgundy / Wine
  ['#4c1d95', '#2e1065'], // Royal Plum
  ['#134e4a', '#042f2e'], // Forest Teal
  ['#78350f', '#451a03'], // Warm Amber / Leather
  ['#3b1c1c', '#1f0d0d'], // Espresso
  ['#312e81', '#1e1b4b'], // Deep Indigo
  ['#374151', '#111827'], // Obsidian Charcoal
];

export function coverPalette(title: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < (title || '').length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  return COVER_PALETTES[hash % COVER_PALETTES.length];
}

const pct = (b: Pick<LibraryDocument, 'percent'>) => Math.round((b.percent ?? 0) * 100);

export function BookCover({
  title,
  author,
  coverUri,
  coverWidth,
  coverHeight,
  width = '100%',
  height,
  radius = 0,
  compact = false,
}: {
  title: string;
  author?: string | null;
  coverUri?: string | null;
  coverWidth?: number | null;
  coverHeight?: number | null;
  width?: DimensionValue;
  height?: DimensionValue;
  radius?: number;
  compact?: boolean;
}) {
  const [imageError, setImageError] = useState(false);
  const [color1, color2] = coverPalette(title);
  const { get } = useSettings();
  const showImage = !!coverUri && !imageError;

  // Fill the frame only when the user forces it, or when the art is already
  // close to the 2:3 frame. Unknown or unusually-shaped art is shown whole
  // (contentFit="contain") over a blurred, dimmed copy of itself.
  const ratio = coverWidth && coverHeight ? coverWidth / coverHeight : null;
  const nearFrame =
    ratio != null && Math.abs(ratio - FRAME_RATIO) / FRAME_RATIO <= FRAME_RATIO_TOLERANCE;
  const fill = get(SettingKeys.deviceCoverFit) === 'crop' || nearFrame;

  return (
    <View
      style={[
        styles.coverContainer,
        {
          width,
          ...(height != null ? { height } : {}),
          borderRadius: radius,
        },
      ]}>
      {showImage ? (
        <View style={StyleSheet.absoluteFill}>
          {!fill && (
            <>
              <Image
                source={{ uri: coverUri }}
                style={StyleSheet.absoluteFill}
                contentFit="cover"
                blurRadius={24}
                cachePolicy="memory-disk"
              />
              <View style={[StyleSheet.absoluteFill, styles.blurScrim]} />
            </>
          )}
          <Image
            source={{ uri: coverUri }}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: radius,
            }}
            contentFit={fill ? 'cover' : 'contain'}
            cachePolicy="memory-disk"
            onError={() => setImageError(true)}
          />
          {/* Subtle book spine shadow on the left */}
          <LinearGradient
            colors={['rgba(0,0,0,0.32)', 'rgba(0,0,0,0.06)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.spineShadow, { borderTopLeftRadius: radius, borderBottomLeftRadius: radius }]}
          />
          {/* Book edge highlight line */}
          <View style={[styles.spineHighlight, { borderTopLeftRadius: radius, borderBottomLeftRadius: radius }]} />
        </View>
      ) : (
        <LinearGradient
          colors={[color1, color2]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[StyleSheet.absoluteFill, styles.fallbackGradient, { borderRadius: radius }]}>
          {/* Spine 3D illusion */}
          <LinearGradient
            colors={['rgba(0,0,0,0.5)', 'rgba(255,255,255,0.08)', 'transparent']}
            start={{ x: 0, y: 0.5 }}
            end={{ x: 1, y: 0.5 }}
            style={[styles.spineShadow, { borderTopLeftRadius: radius, borderBottomLeftRadius: radius }]}
          />
          <View style={[styles.spineHighlight, { borderTopLeftRadius: radius, borderBottomLeftRadius: radius }]} />

          {/* Fallback book design */}
          <View style={[styles.fallbackContent, compact && styles.fallbackCompact]}>
            <View style={styles.ornamentBox}>
              <Icon name="book-outline" size={compact ? 16 : 22} tone="rgba(255,255,255,0.7)" />
            </View>
            <Text
              numberOfLines={compact ? 2 : 3}
              style={[styles.fallbackTitle, compact && styles.fallbackTitleCompact]}>
              {title || 'Untitled'}
            </Text>
            {!compact && !!author && (
              <Text numberOfLines={1} style={styles.fallbackAuthor}>
                {author}
              </Text>
            )}
          </View>
        </LinearGradient>
      )}

      {/* Outer subtle page border */}
      <View
        pointerEvents="none"
        style={[styles.coverBorder, { borderRadius: radius }]}
      />
    </View>
  );
}

export function BookBadges({ book, showBadges }: { book: LibraryDocument; showBadges: boolean }) {
  const isLocal = book.local_uri != null;
  const p = pct(book);

  return (
    <View style={styles.badgeContainer} pointerEvents="none">
      {showBadges && (
        <View style={styles.badgePill}>
          <Text style={styles.badgeFormatText}>{book.format.toUpperCase()}</Text>
        </View>
      )}

      {showBadges && p > 0 && (
        <View style={[styles.badgePill, styles.badgeProgressPill]}>
          <Text style={styles.badgeProgressText}>{p}%</Text>
        </View>
      )}

      {!isLocal && (
        <View style={[styles.badgePill, styles.badgeNotLocalPill]}>
          <Icon name="cloud-offline-outline" size={11} tone="#ffffff" />
          <Text style={styles.badgeNotLocalText}>Remote</Text>
        </View>
      )}
    </View>
  );
}

interface CardProps {
  book: LibraryDocument;
  gridSize: 2 | 3 | 4;
  showBadges: boolean;
  showDetails: boolean;
  onPress: (book: LibraryDocument) => void;
  onLongPress?: (book: LibraryDocument) => void;
}

export function BookCard({ book, gridSize, showBadges, showDetails, onPress, onLongPress }: CardProps) {
  const overlay = gridSize >= 3;
  const p = pct(book);
  const { isDark, accent } = useAppTheme();
  const isLocal = book.local_uri != null;
  const authorText = book.author?.trim() || 'Unknown author';
  const progressText = p > 0 ? `${p}% read` : 'Unread';
  const remoteText = isLocal ? '' : ', Not on this device';
  const accessibilityLabel = `${book.title}, by ${authorText}, ${book.format.toUpperCase()} format, ${progressText}${remoteText}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Tap to read, double tap and hold to remove from library"
      onPress={() => onPress(book)}
      onLongPress={() => onLongPress?.(book)}
      className={pressFeedback} style={[
        styles.cardWrapper,
        {
          backgroundColor: isDark ? '#212125' : '#ffffff',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
      ]}>
      <View style={styles.cardCoverFrame}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.cover_uri}
          coverWidth={book.cover_width}
          coverHeight={book.cover_height}
          radius={overlay ? 10 : 0}
          compact={overlay}
        />
        <BookBadges book={book} showBadges={showBadges} />

        {/* Compact overlay details (3x3 or 4x4) */}
        {overlay && showDetails && (
          <LinearGradient
            colors={['transparent', 'rgba(0,0,0,0.85)']}
            style={styles.compactOverlay}>
            <Text
              numberOfLines={2}
              style={[styles.compactTitle, gridSize === 4 && { fontSize: 10, lineHeight: 12 }]}>
              {book.title}
            </Text>
          </LinearGradient>
        )}

        {/* Compact thin progress line along bottom edge of cover */}
        {p > 0 && (
          <View style={styles.coverProgressBarBackground}>
            <View style={[styles.coverProgressBarFill, { backgroundColor: accent.hex, width: `${p}%` }]} />
          </View>
        )}
      </View>

      {/* 2-column detailed card info below cover (matching landing_screen.jpg) */}
      {!overlay && showDetails && (
        <View style={[styles.cardDetails, { backgroundColor: isDark ? '#212125' : '#ffffff' }]}>
          <Text numberOfLines={1} style={[styles.cardTitle, { color: isDark ? '#f4f4f6' : '#18181b' }]}>
            {book.title}
          </Text>
          <Text numberOfLines={1} style={[styles.cardAuthor, { color: isDark ? '#9a9aa4' : '#64646e' }]}>
            {book.author ?? 'Unknown Author'}
          </Text>
        </View>
      )}
    </Pressable>
  );
}

const addedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
const readDate = new Intl.DateTimeFormat(undefined, {
  month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
});

export function BookRow({ book, position, onPress, onLongPress }: {
  book: LibraryDocument;
  position?: string;
  onPress: (book: LibraryDocument) => void;
  onLongPress?: (book: LibraryDocument) => void;
}) {
  const p = pct(book);
  const timestamp = Date.parse((position ? book.last_read_at : book.created_at) ?? '');
  const date = Number.isFinite(timestamp)
    ? (position ? readDate : addedDate).format(timestamp)
    : 'Unknown date';
  const isLocal = book.local_uri != null;
  const authorText = book.author?.trim() || 'Unknown author';
  const progressText = p > 0 ? `${p}% read` : 'Unread';
  const remoteText = isLocal ? '' : ', Not on this device';
  const dateInfo = position ? `Last read ${date}` : `Added ${date}`;
  const accessibilityLabel = `${book.title}, by ${authorText}, ${book.format.toUpperCase()} format, ${progressText}, ${dateInfo}${remoteText}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint="Tap to read, double tap and hold to remove from library"
      onPress={() => onPress(book)}
      onLongPress={() => onLongPress?.(book)}
      className={`mb-2 flex-row items-center gap-4 rounded-xl border border-line bg-surface p-3.5 ${pressFeedback}`}>
      <View className="flex-1 min-w-0">
        <Text numberOfLines={2} className="font-ui text-tx text-base font-semibold">{book.title}</Text>
        <Text numberOfLines={1} className="font-ui text-mu text-sm mt-0.5">{book.author?.trim() || 'Unknown author'}</Text>
        {position && <Text numberOfLines={2} className="font-ui text-tx text-sm mt-2">{position}</Text>}
        <Text className="font-ui text-mu text-[12px] mt-1">{position ? 'Last read' : 'Added'} {date}</Text>
        {book.local_uri == null && <Text className="font-ui text-mu text-xs">Not on this device</Text>}
        <View className="mt-2 flex-row items-center gap-2">
          <Text className="font-ui text-mu text-[11px] font-semibold">{book.format.toUpperCase()}</Text>
          <View className="h-1 flex-1 max-w-[100px] overflow-hidden rounded-full bg-surface-2">
            <View className="h-full rounded-full bg-accent" style={{ width: `${p}%` }} />
          </View>
          <Text className="font-ui text-mu text-xs">{p}%</Text>
        </View>
      </View>
      <BookCover key={book.cover_uri} title={book.title} author={book.author} coverUri={book.cover_uri}
        coverWidth={book.cover_width} coverHeight={book.cover_height}
        width={64} height={96} radius={6} compact />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  coverContainer: {
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#1e293b',
    aspectRatio: 2 / 3,
  },
  blurScrim: {
    backgroundColor: 'rgba(15,17,21,0.45)',
  },
  spineShadow: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 14,
    zIndex: 2,
  },
  spineHighlight: {
    position: 'absolute',
    left: 2,
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    zIndex: 3,
  },
  fallbackGradient: {
    justifyContent: 'center',
    alignItems: 'center',
    padding: 12,
  },
  fallbackContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    width: '100%',
    paddingHorizontal: 8,
  },
  fallbackCompact: {
    paddingHorizontal: 4,
  },
  ornamentBox: {
    marginBottom: 8,
    opacity: 0.85,
  },
  fallbackTitle: {
    color: '#ffffff',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    lineHeight: 17,
    fontFamily: 'serif',
    textShadowColor: 'rgba(0, 0, 0, 0.5)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  fallbackTitleCompact: {
    fontSize: 11,
    lineHeight: 14,
  },
  fallbackAuthor: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    textAlign: 'center',
    marginTop: 6,
    fontFamily: 'serif',
    fontStyle: 'italic',
  },
  coverBorder: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    zIndex: 4,
  },
  badgeContainer: {
    position: 'absolute',
    top: 6,
    left: 6,
    right: 6,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    zIndex: 5,
  },
  badgePill: {
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
  },
  badgeFormatText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  badgeProgressPill: {
    backgroundColor: 'rgba(37, 99, 235, 0.85)',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  badgeProgressText: {
    color: '#ffffff',
    fontSize: 10,
    fontWeight: '700',
  },
  badgeNotLocalPill: {
    backgroundColor: 'rgba(220, 38, 38, 0.85)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  badgeNotLocalText: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '600',
  },
  cardWrapper: {
    flex: 1,
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.22,
    shadowRadius: 4,
    elevation: 3,
  },
  cardCoverFrame: {
    width: '100%',
    aspectRatio: 2 / 3,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: '#161619',
  },
  compactOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 6,
    paddingBottom: 6,
    paddingTop: 24,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    zIndex: 6,
  },
  compactTitle: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '600',
    lineHeight: 14,
  },
  coverProgressBarBackground: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 3,
    backgroundColor: 'rgba(0,0,0,0.3)',
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    overflow: 'hidden',
    zIndex: 7,
  },
  coverProgressBarFill: {
    height: '100%',
  },
  cardDetails: {
    paddingHorizontal: 10,
    paddingTop: 8,
    paddingBottom: 10,
  },
  cardTitle: {
    fontSize: 13.5,
    fontWeight: '700',
    lineHeight: 18,
  },
  cardAuthor: {
    fontSize: 12,
    marginTop: 2,
  },
});
