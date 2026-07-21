# Public Supabase fallback fix

The application now resolves its browser-safe Supabase configuration in this order:

1. `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from Vite environment files.
2. The embedded public project URL and publishable key in `src/config/public-app-config.ts`.

This prevents the local login page from being blocked when Windows, VS Code, or a
shell session fails to pass `.env` values to Vite. Environment values still override
the defaults.

Only the public/publishable Supabase key is embedded. A service-role key or any
other private server secret must never be added to this file.
