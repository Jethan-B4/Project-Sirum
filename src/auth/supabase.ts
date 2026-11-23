import 'react-native-url-polyfill/auto';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

// Only the public anon key belongs in the app. NEVER ship the service role key.
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Expo evaluates routes in Node when assembling the release manifest.
const clientRuntime = Platform.OS !== 'web' || typeof window !== 'undefined';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: clientRuntime ? AsyncStorage : undefined,
    autoRefreshToken: clientRuntime,
    persistSession: clientRuntime,
    detectSessionInUrl: false,
  },
});

// Refresh tokens only while the app is in the foreground.
if (clientRuntime) AppState.addEventListener('change', (state) => {
  if (state === 'active') {
    supabase.auth.startAutoRefresh();
  } else {
    supabase.auth.stopAutoRefresh();
  }
});
