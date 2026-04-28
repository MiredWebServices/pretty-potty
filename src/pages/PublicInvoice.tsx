import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

// Public hosted invoice page. Path: /i/:token
// Shows invoice + items, "Pay Now" button (Stripe payment link), and (after
// payment) an e-signature panel if a document is attached.

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

const fnUrl = (path: string, params?: Record<string, string>) => {
  const u = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
  if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
  return u.toString();
};

const publicHeaders = { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` };

interface InvoiceData {
  invoice: {
    id: string;
    customer_name: string;
    customer_email: string;
    subtotal_cents: number;
    tax_cents: number;
    total_cents: number;
    currency: string;
    status: string;
    issued_at: string | null;
    due_at: string | null;
    paid_at: string | null;
    customer_notes: string | null;
    stripe_payment_link_url: string | null;
    public_token: string;
  };
  items: Array<{
    id: string;
    description: string;
    quantity: number;
    unit_price_cents: number;
    amount_cents: number;
  }>;
  document: {
    id: string;
    title: string;
    content_html: string;
    required_after_payment: boolean;
    signed_at: string | null;
    signer_name: string | null;
    signer_email: string | null;
  } | null;
}

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

const statusBadge: Record<string, { label: string; cls: string }> = {
  draft:    { label: "Draft",    cls: "bg-gray-100 text-gray-700" },
  sent:     { label: "Awaiting payment", cls: "bg-amber-100 text-amber-800" },
  viewed:   { label: "Awaiting payment", cls: "bg-amber-100 text-amber-800" },
  overdue:  { label: "Overdue",  cls: "bg-red-100 text-red-800" },
  paid:     { label: "Paid",     cls: "bg-emerald-100 text-emerald-800" },
  signed:   { label: "Paid & Signed", cls: "bg-emerald-100 text-emerald-800" },
  void:     { label: "Voided",   cls: "bg-gray-200 text-gray-600" },
};

export default function PublicInvoice() {
  const { token } = useParams<{ token: string }>();
  const [params] = useSearchParams();
  const [data, setData] = useState<InvoiceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Signature panel state
  const [signerName, setSignerName] = useState("");
  const [signerEmail, setSignerEmail] = useState("");
  const [signing, setSigning] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);
  const hasInkRef = useRef(false);

  const justPaid = params.get("paid") === "1";

  // `silent` skips the loading spinner so background polls (after Stripe
  // redirect) don't flash the "Loading invoice..." screen on top of the
  // already-rendered invoice.
  const load = useCallback(
    async (silent = false) => {
      if (!token) return;
      if (!silent) setLoading(true);
      try {
        const r = await fetch(fnUrl("public-invoice", { token }), { headers: publicHeaders });
        const j = await r.json();
        if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
        setData(j);
        setSignerName((prev) => prev || j.invoice.customer_name || "");
        setSignerEmail((prev) => prev || j.invoice.customer_email || "");
      } catch (err) {
        if (!silent) setError(err instanceof Error ? err.message : "Failed to load invoice");
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    load();
  }, [load]);

  // Log a "viewed" event on first load (best effort, don't block UI).
  useEffect(() => {
    if (!token) return;
    fetch(fnUrl("public-invoice"), {
      method: "POST",
      headers: { ...publicHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "viewed", token }),
    }).catch(() => {
      /* ignore */
    });
  }, [token]);

  // Auto-refresh shortly after returning from Stripe so the webhook has time
  // to flip status -> 'paid'. Polls silently (no spinner flash) and stops as
  // soon as the status indicates the webhook has landed.
  const status = data?.invoice.status;
  useEffect(() => {
    if (!justPaid) return;
    if (status === "paid" || status === "signed") return;
    const id = setInterval(() => load(true), 2500);
    const stop = setTimeout(() => clearInterval(id), 30_000);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [justPaid, status, load]);

  // ---------- canvas signature pad ----------
  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * dpr;
    c.height = rect.height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
  }, []);

  useEffect(() => {
    if (data?.document && !data.document.signed_at) {
      // Set up after canvas is rendered.
      const id = requestAnimationFrame(setupCanvas);
      return () => cancelAnimationFrame(id);
    }
  }, [data?.document, setupCanvas]);

  const posFromEvent = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    canvasRef.current?.setPointerCapture(e.pointerId);
    drawingRef.current = true;
    lastPosRef.current = posFromEvent(e);
  };
  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPosRef.current) return;
    const p = posFromEvent(e);
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    lastPosRef.current = p;
    hasInkRef.current = true;
  };
  const endDraw = () => {
    drawingRef.current = false;
    lastPosRef.current = null;
  };
  const clearCanvas = () => {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    ctx.clearRect(0, 0, c.width, c.height);
    hasInkRef.current = false;
  };

  const submitSignature = async () => {
    if (!token || !data) return;
    if (!signerName.trim()) {
      toast.error("Please enter your full name");
      return;
    }
    if (!hasInkRef.current) {
      toast.error("Please sign in the box above");
      return;
    }
    const c = canvasRef.current!;
    const dataUrl = c.toDataURL("image/png");
    setSigning(true);
    try {
      const r = await fetch(fnUrl("public-invoice"), {
        method: "POST",
        headers: { ...publicHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sign",
          token,
          signer_name: signerName.trim(),
          signer_email: signerEmail.trim(),
          signature_data_url: dataUrl,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j?.error ?? `HTTP ${r.status}`);
      toast.success("Signature recorded. Thank you!");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to submit signature");
    } finally {
      setSigning(false);
    }
  };

  // ---------- render ----------
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-gray-500">
        Loading invoice…
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
        <h1 className="text-2xl font-semibold mb-2">Invoice not found</h1>
        <p className="text-gray-600">{error ?? "This link may have expired."}</p>
      </div>
    );
  }

  const { invoice, items, document: doc } = data;
  const badge = statusBadge[invoice.status] ?? statusBadge.draft;
  const paid = invoice.status === "paid" || invoice.status === "signed";
  const needsSignature = paid && doc && !doc.signed_at;
  const allDone = paid && (!doc || doc.signed_at);

  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4 sm:px-6">
      <div className="max-w-2xl mx-auto bg-white shadow-sm rounded-xl overflow-hidden">
        {/* Header */}
        <div className="px-6 sm:px-8 py-6 border-b">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-wider text-gray-500">Pretty Potty</p>
              <h1 className="text-2xl font-semibold mt-1">Your invoice</h1>
              <p className="text-sm text-gray-600 mt-1">Billed to {invoice.customer_name}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-medium ${badge.cls}`}>
              {badge.label}
            </span>
          </div>

          {invoice.due_at && !paid && (
            <p className="text-sm text-gray-600 mt-3">
              Due by{" "}
              <strong>
                {new Date(invoice.due_at).toLocaleDateString("en-US", { dateStyle: "long" })}
              </strong>
            </p>
          )}
          {paid && invoice.paid_at && (
            <p className="text-sm text-emerald-700 mt-3">
              Paid on {new Date(invoice.paid_at).toLocaleDateString("en-US", { dateStyle: "long" })}
            </p>
          )}
        </div>

        {/* Items */}
        <div className="px-6 sm:px-8 py-6">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 text-xs uppercase tracking-wider">
                <th className="pb-3 font-medium">Item</th>
                <th className="pb-3 font-medium text-right w-16">Qty</th>
                <th className="pb-3 font-medium text-right w-28">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {items.map((it) => (
                <tr key={it.id}>
                  <td className="py-3 pr-3 align-top">{it.description}</td>
                  <td className="py-3 px-2 text-right tabular-nums align-top">{it.quantity}</td>
                  <td className="py-3 pl-2 text-right tabular-nums align-top">
                    {fmtMoney(it.amount_cents, invoice.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="text-sm">
              <tr>
                <td colSpan={2} className="pt-4 pr-3 text-right text-gray-600">
                  Subtotal
                </td>
                <td className="pt-4 pl-2 text-right tabular-nums">
                  {fmtMoney(invoice.subtotal_cents, invoice.currency)}
                </td>
              </tr>
              {invoice.tax_cents > 0 && (
                <tr>
                  <td colSpan={2} className="py-1 pr-3 text-right text-gray-600">
                    Tax
                  </td>
                  <td className="py-1 pl-2 text-right tabular-nums">
                    {fmtMoney(invoice.tax_cents, invoice.currency)}
                  </td>
                </tr>
              )}
              <tr className="font-semibold text-base">
                <td colSpan={2} className="pt-2 pr-3 text-right">
                  Total
                </td>
                <td className="pt-2 pl-2 text-right tabular-nums">
                  {fmtMoney(invoice.total_cents, invoice.currency)}
                </td>
              </tr>
            </tfoot>
          </table>

          {invoice.customer_notes && (
            <div className="mt-6 p-4 bg-gray-50 rounded-lg text-sm text-gray-700 whitespace-pre-wrap">
              {invoice.customer_notes}
            </div>
          )}
        </div>

        {/* Pay button */}
        {!paid && invoice.stripe_payment_link_url && invoice.status !== "void" && (
          <div className="px-6 sm:px-8 pb-8">
            <a
              href={invoice.stripe_payment_link_url}
              className="block w-full text-center bg-slate-900 hover:bg-slate-800 text-white font-semibold py-3.5 rounded-lg transition-colors"
            >
              Pay {fmtMoney(invoice.total_cents, invoice.currency)} with Stripe
            </a>
            <p className="text-xs text-gray-500 mt-3 text-center">
              Secure payment powered by Stripe. Cards, Apple Pay, Google Pay accepted.
            </p>
          </div>
        )}

        {!paid && !invoice.stripe_payment_link_url && invoice.status !== "void" && (
          <div className="px-6 sm:px-8 pb-8">
            <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
              Online payment isn't ready for this invoice yet. Please contact us at
              <a href="mailto:hello@getprettypotty.com" className="underline ml-1">
                hello@getprettypotty.com
              </a>
              .
            </div>
          </div>
        )}

        {invoice.status === "void" && (
          <div className="px-6 sm:px-8 pb-8">
            <div className="rounded-lg bg-gray-100 p-4 text-sm text-gray-700 text-center">
              This invoice has been voided.
            </div>
          </div>
        )}

        {/* Document / signature */}
        {doc && (
          <div className="border-t bg-slate-50 px-6 sm:px-8 py-6">
            <h2 className="text-lg font-semibold">{doc.title}</h2>
            {!paid && (
              <p className="text-sm text-gray-600 mt-1">
                You'll be able to sign this {doc.required_after_payment ? "after payment" : "below"}.
              </p>
            )}

            <div
              className="prose prose-sm max-w-none mt-4 bg-white rounded-lg border p-4 max-h-72 overflow-y-auto"
              dangerouslySetInnerHTML={{ __html: doc.content_html }}
            />

            {needsSignature && (
              <div className="mt-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="signer-name">Full name</Label>
                    <Input
                      id="signer-name"
                      value={signerName}
                      onChange={(e) => setSignerName(e.target.value)}
                      placeholder="Type your full legal name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="signer-email">Email</Label>
                    <Input
                      id="signer-email"
                      type="email"
                      value={signerEmail}
                      onChange={(e) => setSignerEmail(e.target.value)}
                      placeholder="you@example.com"
                    />
                  </div>
                </div>

                <div>
                  <Label>Signature</Label>
                  <div className="mt-1 rounded-lg border bg-white">
                    <canvas
                      ref={canvasRef}
                      className="w-full h-40 touch-none rounded-lg cursor-crosshair"
                      onPointerDown={startDraw}
                      onPointerMove={moveDraw}
                      onPointerUp={endDraw}
                      onPointerCancel={endDraw}
                      onPointerLeave={endDraw}
                    />
                  </div>
                  <div className="mt-2 flex justify-between items-center">
                    <button
                      type="button"
                      onClick={clearCanvas}
                      className="text-sm text-gray-600 hover:text-gray-900 underline"
                    >
                      Clear
                    </button>
                    <p className="text-xs text-gray-500">
                      By signing, you agree to the terms above.
                    </p>
                  </div>
                </div>

                <Button onClick={submitSignature} disabled={signing} className="w-full">
                  {signing ? "Submitting…" : "Submit signature"}
                </Button>
              </div>
            )}

            {doc.signed_at && (
              <div className="mt-4 rounded-lg bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-900">
                Signed by <strong>{doc.signer_name}</strong> on{" "}
                {new Date(doc.signed_at).toLocaleDateString("en-US", { dateStyle: "long" })}.
              </div>
            )}
          </div>
        )}

        {/* Done state */}
        {allDone && (
          <div className="px-6 sm:px-8 py-6 border-t text-center text-sm text-gray-600">
            All set — thank you for choosing Pretty Potty. We'll be in touch shortly.
          </div>
        )}

        {/* Footer */}
        <div className="px-6 sm:px-8 py-4 border-t text-xs text-gray-500 flex flex-col sm:flex-row sm:justify-between gap-2">
          <span>Pretty Potty · (512) 270-5164 · getprettypotty.com</span>
          <span>Questions? hello@getprettypotty.com</span>
        </div>
      </div>
    </div>
  );
}
