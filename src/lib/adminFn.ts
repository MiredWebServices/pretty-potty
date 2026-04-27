// Shared helper for admin pages: call Supabase edge functions with the
// current user's access token + Supabase anon key. Mirrors the inline helper
// in AdminInbox.tsx but reusable across the admin area.

import { supabase } from "@/integrations/supabase/client";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

export const fnUrl = (path: string, params?: Record<string, string>) => {
  const u = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
};

export async function callAdminFn<T = unknown>(
  path: string,
  init: RequestInit = {},
  params?: Record<string, string>,
): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not signed in");
  const res = await fetch(fnUrl(path, params), {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      apikey: ANON_KEY,
    },
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error((j as { error?: string })?.error ?? `HTTP ${res.status}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return j as T;
}
