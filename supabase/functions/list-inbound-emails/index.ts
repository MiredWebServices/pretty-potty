// Returns inbound emails for the admin inbox UI.
// Authentication: Supabase Auth (the caller must include their access_token
// in the Authorization header). Authorization: the user's email must be
// present in the public.admin_users allowlist table.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Validate the user's JWT and extract their email.
    const authHeader = req.headers.get("Authorization") ?? "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Missing Authorization" }, 401);

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(jwt);
    if (userErr || !userData?.user?.email) {
      return json({ error: "Invalid session" }, 401);
    }
    const email = userData.user.email.toLowerCase();

    // 2. Service-role client for everything else.
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 3. Allowlist gate.
    const { data: adminRow } = await supabase
      .from("admin_users")
      .select("email")
      .ilike("email", email)
      .maybeSingle();
    if (!adminRow) return json({ error: "Not authorized" }, 403);

    const url = new URL(req.url);
    const action = url.searchParams.get("action") ?? "list";

    // Normalize a subject for thread grouping: strip Re:/Fwd: prefixes,
    // lowercase, collapse whitespace.
    const normSubject = (s: string | null | undefined) =>
      (s ?? "")
        .replace(/^(\s*(re|fw|fwd)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase();

    if (action === "list") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
      const q = url.searchParams.get("q")?.trim() ?? "";
      const archived = url.searchParams.get("archived") ?? "false"; // 'true' | 'false' | 'all'

      let query = supabase
        .from("inbound_emails")
        .select(
          "id, resend_email_id, from_address, to_addresses, subject, received_at, read_at, archived_at, attachments",
        )
        .order("received_at", { ascending: false })
        .limit(limit);

      if (archived === "false") query = query.is("archived_at", null);
      else if (archived === "true") query = query.not("archived_at", "is", null);

      if (q) {
        // Use Postgres full-text on the generated tsvector. Escape colons.
        // websearch_to_tsquery is most forgiving; falls back to ilike if FTS misses.
        query = query.textSearch("search_vector", q, { type: "websearch", config: "simple" });
      }

      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ emails: data ?? [] });
    }

    if (action === "get") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      const { data, error } = await supabase
        .from("inbound_emails")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Not found" }, 404);

      // Mark as read on first fetch.
      if (!data.read_at) {
        await supabase
          .from("inbound_emails")
          .update({ read_at: new Date().toISOString() })
          .eq("id", id);
      }

      // Build the thread:
      //  - sibling inbound emails: same from_address + same normalized subject
      //  - replies we sent: outbound_replies linked to any of those inbounds
      const threadKey = normSubject(data.subject);
      const { data: siblings } = await supabase
        .from("inbound_emails")
        .select(
          "id, from_address, subject, received_at, text_body, html_body",
        )
        .ilike("from_address", data.from_address)
        .order("received_at", { ascending: true });

      const siblingIds = (siblings ?? [])
        .filter((s) => normSubject(s.subject) === threadKey)
        .map((s) => s.id);

      const { data: replies } = siblingIds.length
        ? await supabase
            .from("outbound_replies")
            .select(
              "id, inbound_email_id, from_address, to_addresses, subject, body_text, body_html, sent_by, created_at",
            )
            .in("inbound_email_id", siblingIds)
            .order("created_at", { ascending: true })
        : { data: [] as Array<Record<string, unknown>> };

      return json({
        email: data,
        thread: {
          inbounds: (siblings ?? []).filter((s) => normSubject(s.subject) === threadKey),
          replies: replies ?? [],
        },
      });
    }

    if (action === "list_sent") {
      const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 500);
      const q = url.searchParams.get("q")?.trim() ?? "";

      let query = supabase
        .from("outbound_replies")
        .select(
          "id, inbound_email_id, from_address, to_addresses, subject, body_text, sent_by, created_at",
        )
        .order("created_at", { ascending: false })
        .limit(limit);

      if (q) {
        // outbound_replies has no FTS; do a simple ilike across subject + body.
        const like = `%${q.replace(/[%_]/g, (m) => `\\${m}`)}%`;
        query = query.or(
          `subject.ilike.${like},body_text.ilike.${like}`,
        );
      }

      const { data, error } = await query;
      if (error) return json({ error: error.message }, 500);
      return json({ emails: data ?? [] });
    }

    if (action === "get_sent") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      const { data, error } = await supabase
        .from("outbound_replies")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) return json({ error: error.message }, 500);
      if (!data) return json({ error: "Not found" }, 404);
      return json({ reply: data });
    }

    if (action === "archive" || action === "unarchive") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "Missing id" }, 400);
      const { error } = await supabase
        .from("inbound_emails")
        .update({ archived_at: action === "archive" ? new Date().toISOString() : null })
        .eq("id", id);
      if (error) return json({ error: error.message }, 500);
      return json({ ok: true });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("list-inbound-emails error:", message);
    return json({ error: message }, 500);
  }
});
