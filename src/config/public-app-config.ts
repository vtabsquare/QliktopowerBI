/**
 * Public browser configuration.
 *
 * Supabase project URLs and publishable/anonymous keys are designed to be
 * embedded in frontend applications. Environment values still take priority,
 * while these defaults keep local extracted packages usable when a Windows
 * shell or editor fails to pass Vite environment files into the dev server.
 *
 * Never place a Supabase service-role key or any private server secret here.
 */
const envSupabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const envSupabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

export const PUBLIC_APP_CONFIG = Object.freeze({
  supabaseUrl:
    envSupabaseUrl || "https://tdljizujlzbylsvdbjtu.supabase.co",
  supabaseAnonKey:
    envSupabaseAnonKey || "sb_publishable_2QSRde3HrviB8wuiLuiTQA_F2yR4KbV",
  supabaseConfigSource:
    envSupabaseUrl && envSupabaseAnonKey
      ? ("environment" as const)
      : ("embedded-public-fallback" as const),
});
