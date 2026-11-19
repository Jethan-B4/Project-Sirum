import * as Crypto from 'expo-crypto';

/** Generates a random UUID v4 string. */
export function uuid(): string {
  return Crypto.randomUUID();
}
