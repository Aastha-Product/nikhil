// Server-only Supabase client. Uses the secret (service_role) key, which bypasses RLS —
// never import this from a client component.

import "server-only";
import { createClient } from "@supabase/supabase-js";

let admin;

export function isConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

export function db() {
  if (!isConfigured()) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set");
  admin ??= createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return admin;
}

/** Deep link to the Table Editor so Nikhil can add/remove companies without code. */
export function tableEditorUrl() {
  const ref = process.env.SUPABASE_URL?.match(/https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1];
  return ref ? `https://supabase.com/dashboard/project/${ref}/editor` : "https://supabase.com/dashboard";
}
