import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type DimensionValue } from 'react-native';

import { Icon } from '@/components/ui/icon';
import type { LibraryDocument } from '@/db/repositories/documents';
import { useAppTheme } from '@/theme/ThemeProvider';

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
  const showImage = !!coverUri && !imageError;

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
          <Image
            source={{ uri: coverUri }}
            style={{
              width: '100%',
              height: '100%',
              borderRadius: radius,
            }}
            contentFit="cover"
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
}

export function BookCard({ book, gridSize, showBadges, showDetails, onPress }: CardProps) {
  const overlay = gridSize >= 3;
  const p = pct(book);
  const { isDark } = useAppTheme();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      onPress={() => onPress(book)}
      style={({ pressed }) => [
        styles.cardWrapper,
        {
          backgroundColor: isDark ? '#212125' : '#ffffff',
          borderColor: isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
          opacity: pressed ? 0.88 : 1,
        },
      ]}>
      <View style={styles.cardCoverFrame}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.cover_uri}
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
            <View style={[styles.coverProgressBarFill, { width: `${p}%` }]} />
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

export function BookRow({ book, onPress }: { book: LibraryDocument; onPress: (b: LibraryDocument) => void }) {
  const p = pct(book);
  const isLocal = book.local_uri != null;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={book.title}
      onPress={() => onPress(book)}
      style={({ pressed }) => [styles.rowWrapper, { opacity: pressed ? 0.82 : 1 }]}>
      <View style={styles.rowCoverFrame}>
        <BookCover
          title={book.title}
          author={book.author}
          coverUri={book.cover_uri}
          coverWidth={book.cover_width}
          coverHeight={book.cover_height}
          width={52}
          height={78}
          radius={6}
          compact
        />
      </View>

      <View style={styles.rowContent}>
        <View style={styles.rowTitleHeader}>
          <Text numberOfLines={1} style={styles.rowTitle}>
            {book.title}
          </Text>
          <View style={styles.rowFormatBadge}>
            <Text style={styles.rowFormatText}>{book.format.toUpperCase()}</Text>
          </View>
        </View>

        <Text numberOfLines={1} style={styles.rowAuthor}>
          {book.author ?? 'Unknown Author'}
          {!isLocal && ' · Not on this device'}
        </Text>

        <View style={styles.rowBottomRow}>
          <View style={styles.rowProgressTrack}>
            <View style={[styles.rowProgressBar, { width: `${p}%` }]} />
          </View>
          <Text style={styles.rowProgressLabel}>{p}%</Text>
        </View>
      </View>

      <Icon name="chevron-forward" size={18} tone="muted" />
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
    backgroundColor: 'rgb(var(--ac))',
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
  rowWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgb(var(--surface))',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: 'rgb(var(--ln))',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  rowCoverFrame: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.18,
    shadowRadius: 3,
    elevation: 2,
  },
  rowContent: {
    flex: 1,
    marginLeft: 12,
    marginRight: 8,
  },
  rowTitleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  rowTitle: {
    flex: 1,
    color: 'rgb(var(--tx))',
    fontSize: 15,
    fontWeight: '600',
  },
  rowFormatBadge: {
    backgroundColor: 'rgb(var(--surface-2))',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  rowFormatText: {
    color: 'rgb(var(--mu))',
    fontSize: 10,
    fontWeight: '700',
  },
  rowAuthor: {
    color: 'rgb(var(--mu))',
    fontSize: 13,
    marginTop: 2,
  },
  rowBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  rowProgressTrack: {
    flex: 1,
    height: 4,
    backgroundColor: 'rgb(var(--surface-2))',
    borderRadius: 2,
    overflow: 'hidden',
  },
  rowProgressBar: {
    height: '100%',
    backgroundColor: 'rgb(var(--ac))',
    borderRadius: 2,
  },
  rowProgressLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: 'rgb(var(--mu))',
    minWidth: 32,
    textAlign: 'right',
  },
});
