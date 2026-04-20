import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend";
const NOTIFY_TO = "getprettypotty@gmail.com";
const FROM_ADDRESS = "Pretty Potty <onboarding@resend.dev>";

const schema = z.object({
  name: z.string().trim().min(1).max(100),
  phone: z.string().trim().min(7).max(30),
  email: z.string().trim().email().max(255),
  eventDate: z.string().max(40).optional().nullable(),
  location: z.string().trim().max(120).optional().nullable(),
  guests: z.string().max(20).optional().nullable(),
  message: z.string().trim().max(1000).optional().nullable(),
});

const escape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!LOVABLE_API_KEY || !RESEND_API_KEY) {
      throw new Error("Email service not configured");
    }

    const body = await req.json();
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return new Response(
        JSON.stringify({ error: "Invalid form data", details: parsed.error.flatten() }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const data = parsed.data;

    // 1. Save to database
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { error: dbError } = await supabase.from("quote_requests").insert({
      name: data.name,
      phone: data.phone,
      email: data.email,
      event_date: data.eventDate || null,
      location: data.location || null,
      guests: data.guests || null,
      message: data.message || null,
    });
    if (dbError) {
      console.error("DB insert error:", dbError);
      throw new Error("Failed to save quote request");
    }

    // 2. Notify business
    const notifyHtml = `
      <h2>New Quote Request</h2>
      <p><strong>Name:</strong> ${escape(data.name)}</p>
      <p><strong>Phone:</strong> ${escape(data.phone)}</p>
      <p><strong>Email:</strong> ${escape(data.email)}</p>
      <p><strong>Event date:</strong> ${escape(data.eventDate || "—")}</p>
      <p><strong>Location:</strong> ${escape(data.location || "—")}</p>
      <p><strong>Guest count:</strong> ${escape(data.guests || "—")}</p>
      <p><strong>Message:</strong><br/>${escape(data.message || "—").replace(/\n/g, "<br/>")}</p>
    `;

    const notifyRes = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [NOTIFY_TO],
        reply_to: data.email,
        subject: `New quote request — ${data.name}`,
        html: notifyHtml,
      }),
    });
    if (!notifyRes.ok) {
      const t = await notifyRes.text();
      console.error("Notify email failed:", notifyRes.status, t);
    }

    // 3. Customer confirmation
    const confirmHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; max-width: 560px; margin: 0 auto;">
        <h2 style="color:#111;">Thanks, ${escape(data.name.split(" ")[0])} ✨</h2>
        <p>We received your quote request for Pretty Potty Austin and will reach out within <strong>24 hours</strong> with custom pricing.</p>
        <p>Here's what you sent us:</p>
        <ul>
          <li><strong>Event date:</strong> ${escape(data.eventDate || "—")}</li>
          <li><strong>Location:</strong> ${escape(data.location || "—")}</li>
          <li><strong>Guest count:</strong> ${escape(data.guests || "—")}</li>
        </ul>
        <p>If your event is urgent, call or text us at <strong>(737) 235-8019</strong>.</p>
        <p style="margin-top:24px;">— The Pretty Potty team</p>
      </div>
    `;

    const confirmRes = await fetch(`${GATEWAY_URL}/emails`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "X-Connection-Api-Key": RESEND_API_KEY,
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [data.email],
        reply_to: NOTIFY_TO,
        subject: "We got your request — Pretty Potty Austin",
        html: confirmHtml,
      }),
    });
    if (!confirmRes.ok) {
      const t = await confirmRes.text();
      console.error("Confirmation email failed:", confirmRes.status, t);
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("send-quote-request error:", message);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});