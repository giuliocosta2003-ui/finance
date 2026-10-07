// src/lib/supabase.js
// Client Supabase. Nel frontend vive SOLO la chiave publishable: le chiavi
// segrete (Claude API, API prezzi) stanno nei secret delle Edge Function.
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "VITE_SUPABASE_URL o VITE_SUPABASE_PUBLISHABLE_KEY mancanti. Copia .env.example in .env."
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storageKey: "finance_session",
  },
});
