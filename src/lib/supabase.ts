import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { PUBLIC_APP_CONFIG } from '@/config/public-app-config';

const supabaseUrl = PUBLIC_APP_CONFIG.supabaseUrl;
const supabaseAnonKey = PUBLIC_APP_CONFIG.supabaseAnonKey;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
export const supabaseConfigSource = PUBLIC_APP_CONFIG.supabaseConfigSource;

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (null as unknown as SupabaseClient);
