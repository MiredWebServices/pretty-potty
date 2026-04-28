// Shared admin auth helper for invoice/admin edge functions.
// Validates the Supabase JWT and confirms the email is in admin_users.
// Returns the admin email and a service-role Supabase client.

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, GET, PUT, PATCH, DELETE, OPTIONS",
};

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

export interface AdminContext {
  adminEmail: string;
  supabase: SupabaseClient;
}

/**
 * Validates a request as an authenticated admin.
 * Throws a Response on auth failure (caller should `return` it).
 */
export async function requireAdmin(req: Request): Promise<AdminContext> {
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) throw json({ error: "Missing Authorization" }, 401);

  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userData?.user?.email) throw json({ error: "Invalid session" }, 401);
  const adminEmail = userData.user.email.toLowerCase();

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const { data: adminRow } = await supabase
    .from("admin_users")
    .select("email")
    .ilike("email", adminEmail)
    .maybeSingle();
  if (!adminRow) throw json({ error: "Not authorized" }, 403);

  return { adminEmail, supabase };
}

export function serviceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
}

/** Public site origin used for hosted invoice URLs. */
export function siteOrigin(): string {
  return Deno.env.get("PUBLIC_SITE_URL") ?? "https://getprettypotty.com";
}
