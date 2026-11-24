import { Image } from 'expo-image';
import { StyleSheet, View } from 'react-native';

/** Fill the viewport around the uncropped cover using colors from the same artwork. */
export function ReaderCover({ uri, label, height }: {
  uri: string; label: string; height: number;
}) {
  return <View style={{ height, overflow: 'hidden' }}>
    <Image accessible={false} source={{ uri }} contentFit="cover" blurRadius={24}
      style={[StyleSheet.absoluteFill, { opacity: 0.4 }]} />
    <Image accessible accessibilityLabel={label} source={{ uri }} contentFit="contain" style={StyleSheet.absoluteFill} />
  </View>;
}
