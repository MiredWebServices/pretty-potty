// Cron worker: fires AI replies that were scheduled by receive-sms.
//
// Trigger: a Supabase Cron / external scheduler hitting this endpoint
// every minute with `Authorization: Bearer $CRON_SECRET`.
//
//   curl -X POST https://<project-ref>.supabase.co/functions/v1/sms-process-pending \
//        -H "Authorization: Bearer $CRON_SECRET"
//
// Logic:
//   1. SELECT threads where next_ai_at <= now()
//   2. For each, call runScheduledAiReply(), which re-checks all guards
//      (admin replied? bot muted? quiet hours? rate limit?) before calling
//      Claude. If those guards fail, the row is just cleared / logged.
//
// Deploy with `--no-verify-jwt`.

import { corsHeaders, serviceClient } from "../_shared/admin.ts";
import { runScheduledAiReply } from "../_shared/ai-pipeline.ts";

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), {
    status: s,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  // Shared-secret auth (mirrors invoice-reminders).
  const expected = Deno.env.get("CRON_SECRET");
  if (expected) {
    const auth = req.headers.get("Authorization") ?? "";
    const headerSecret = req.headers.get("x-cron-secret") ?? "";
    const bearer = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (bearer !== expected && headerSecret !== expected) {
      return json({ error: "Unauthorized" }, 401);
    }
  }

  const supabase = serviceClient();
  const nowIso = new Date().toISOString();

  // Find every thread whose AI reply is now due. Cap to a sane batch.
  const { data: due, error } = await supabase
    .from("sms_threads")
    .select("id, next_ai_at")
    .not("next_ai_at", "is", null)
    .lte("next_ai_at", nowIso)
    .order("next_ai_at", { ascending: true })
    .limit(50);
  if (error) return json({ error: error.message }, 500);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const t of due ?? []) {
    try {
      await runScheduledAiReply(supabase, t.id);
      results.push({ id: t.id, ok: true });
    } catch (e) {
      console.error("runScheduledAiReply failed for", t.id, e);
      results.push({ id: t.id, ok: false, error: (e as Error).message });
    }
  }

  return json({ ok: true, processed: results.length, results });
});
