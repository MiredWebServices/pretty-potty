// Shared helpers for the inbound SMS pipeline.
// - verifyQuoSignature(): HMAC-SHA256 verification per Quo / OpenPhone spec.
//   Header format: `hmac;<version>;<timestamp>;<base64Signature>`.
//   Signed payload: `${timestamp}.${rawBody}` using a base64-decoded key,
//   matching the canonical example at:
//     https://support.quo.com/core-concepts/integrations/webhooks
// - sendQuoSms(): thin wrapper around POST https://api.openphone.com/v1/messages.

const QUO_API_URL = "https://api.openphone.com/v1/messages";

export async function verifyQuoSignature(
  rawBody: string,
  header: string | null,
  signingKeyBase64: string | undefined,
): Promise<boolean> {
  if (!signingKeyBase64) return false;
  if (!header) return false;
  const parts = header.split(";");
  if (parts.length !== 4) return false;
  const [scheme, _version, timestamp, providedDigest] = parts;
  if (scheme !== "hmac" || !timestamp || !providedDigest) return false;

  // Reject very old / future-dated payloads to mitigate replay (5 min window).
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  const skew = Math.abs(Date.now() - ts);
  if (skew > 5 * 60 * 1000) return false;

  // Decode the signing key from base64 to raw bytes.
  const keyBytes = Uint8Array.from(atob(signingKeyBase64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const data = new TextEncoder().encode(`${timestamp}.${rawBody}`);
  const sig = await crypto.subtle.sign("HMAC", key, data);
  const computed = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Constant-time compare.
  if (computed.length !== providedDigest.length) return false;
  let diff = 0;
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ providedDigest.charCodeAt(i);
  }
  return diff === 0;
}

export interface QuoSendResult {
  ok: boolean;
  id?: string;
  error?: string;
  raw?: unknown;
}

export async function sendQuoSms(opts: {
  from: string;
  to: string;
  content: string;
}): Promise<QuoSendResult> {
  const apiKey = Deno.env.get("QUO_API_KEY") ?? Deno.env.get("OPENPHONE_API_KEY");
  if (!apiKey) return { ok: false, error: "QUO_API_KEY not configured" };

  const r = await fetch(QUO_API_URL, {
    method: "POST",
    headers: {
      // Quo / OpenPhone uses raw API key (no Bearer prefix).
      Authorization: apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: opts.from, to: [opts.to], content: opts.content }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, error: j?.message ?? j?.error?.message ?? `HTTP ${r.status}`, raw: j };
  }
  return { ok: true, id: j?.data?.id ?? j?.id, raw: j };
}

/**
 * Pre-LLM routing heuristics. Returns a reason if the message is clearly
 * NOT a real customer inquiry the AI should reply to (OTP / 2FA / marketing
 * blasts / short-code senders) — null otherwise.
 *
 * Costs zero tokens and runs before we ever call Claude.
 */
export function detectAutomatedNoise(args: {
  fromNumber: string;
  body: string;
}): string | null {
  const { fromNumber, body } = args;

  // Strip leading + and any non-digits to count the digits.
  const digits = fromNumber.replace(/\D/g, "");
  // Real US/CA mobile numbers are 10 (or 11 with country code). Anything
  // shorter is a short-code (banks, airlines, 2FA providers, marketing).
  if (digits.length > 0 && digits.length < 10) {
    return "shortcode_sender";
  }

  const text = body.toLowerCase();

  // Common OTP / 2FA / automation patterns.
  const automationPatterns: Array<[RegExp, string]> = [
    [/\b(verification|confirmation|security|access|login|one[\s-]?time)\s*code\b/, "otp_keyword"],
    [/\byour\s+code\s+is\b/, "otp_phrase"],
    [/\bcode[:\s]+\d{4,8}\b/, "otp_numeric"],
    [/\b(\d{4,8})\s+is\s+your\s+(verification|security|login|otp)\s*code\b/, "otp_phrase2"],
    [/\bdo\s+not\s+reply\b/, "do_not_reply"],
    [/\bthis\s+is\s+an\s+automated\s+message\b/, "automated_self_id"],
    [/\bmsg(?:&|\s+and\s+)?data\s+rates\s+may\s+apply\b/, "marketing_disclaimer"],
    [/\breply\s+(stop|help)\s+to\b/, "marketing_optout"],
    [/\b(unsubscribe|opt[\s-]?out)\b.*\breply\b/, "marketing_optout"],
  ];

  for (const [re, label] of automationPatterns) {
    if (re.test(text)) return label;
  }

  return null;
}

/** Returns true if the current time is inside the configured quiet hours. */
export function isInQuietHours(
  now: Date,
  timezone: string,
  startHour: number,
  endHour: number,
): boolean {
  // Convert "now" into the target timezone's wall-clock hour.
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
  });
  const hour = Number(fmt.format(now));
  if (Number.isNaN(hour)) return false;

  if (startHour === endHour) return false;
  if (startHour < endHour) {
    // e.g. 1 -> 5
    return hour >= startHour && hour < endHour;
  }
  // Overnight window e.g. 21 -> 8.
  return hour >= startHour || hour < endHour;
}
