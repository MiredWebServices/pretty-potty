import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { callAdminFn } from "@/lib/adminFn";
import { toast } from "sonner";

interface ItemDraft {
  description: string;
  quantity: string;
  unit_price: string; // dollars, free-text
}

const blankItem = (): ItemDraft => ({ description: "", quantity: "1", unit_price: "" });

const fmtMoney = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

const dollarsToCents = (s: string): number => {
  const n = Number(String(s).replace(/[^0-9.\-]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

const DEFAULT_DOC = `<p>This Service Agreement ("Agreement") is between Pretty Potty ("Provider") and the customer named on the invoice ("Customer").</p>
<ol>
  <li><strong>Services.</strong> Provider will deliver and service luxury restroom trailer(s) as itemized above.</li>
  <li><strong>Payment.</strong> Customer agrees to the total stated above. Payment confirms Customer's acceptance of these terms.</li>
  <li><strong>Cancellation.</strong> Cancellations within 14 days of the event date are non-refundable. Earlier cancellations refunded less a 25% booking fee.</li>
  <li><strong>Damage.</strong> Customer is responsible for any damage to the unit beyond ordinary wear during the rental period.</li>
  <li><strong>Liability.</strong> Provider is not liable for indirect or consequential damages. Total liability is capped at the contract amount.</li>
</ol>
<p>By signing, Customer agrees to the terms above.</p>`;

export default function AdminInvoiceNew() {
  const nav = useNavigate();
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [dueAt, setDueAt] = useState(""); // yyyy-mm-dd
  // Tax rate as a percent string. 8.25 = TX state 6.25 + Austin local 2.
  const [taxPercent, setTaxPercent] = useState("8.25");
  const [emailSubject, setEmailSubject] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [items, setItems] = useState<ItemDraft[]>([blankItem()]);

  const [attachDoc, setAttachDoc] = useState(true);
  const [docTitle, setDocTitle] = useState("Pretty Potty Service Agreement");
  const [docHtml, setDocHtml] = useState(DEFAULT_DOC);

  const [sendNow, setSendNow] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [sendSms, setSendSms] = useState(true);

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const updateItem = (i: number, patch: Partial<ItemDraft>) =>
    setItems((prev) => prev.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));
  const addItem = () => setItems((prev) => [...prev, blankItem()]);
  const removeItem = (i: number) =>
    setItems((prev) => (prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i)));

  const subtotalCents = items.reduce(
    (s, it) => s + Math.round(Number(it.quantity || 0) * dollarsToCents(it.unit_price)),
    0,
  );
  const taxBps = Math.max(
    0,
    Math.round(Number(String(taxPercent).replace(/[^0-9.\-]/g, "") || 0) * 100),
  );
  const taxCents = Math.round((subtotalCents * taxBps) / 10_000);
  const totalCents = subtotalCents + taxCents;

  const submit = async () => {
    if (!customerName.trim() || !customerEmail.trim()) {
      toast.error("Customer name and email are required");
      return;
    }
    const cleanItems = items
      .filter((it) => it.description.trim())
      .map((it) => ({
        description: it.description.trim(),
        quantity: Number(it.quantity || 1),
        unit_price_cents: dollarsToCents(it.unit_price),
      }));
    if (cleanItems.length === 0) {
      toast.error("Add at least one line item");
      return;
    }

    setSubmitting(true);
    try {
      const created = await callAdminFn<{
        invoice_id: string;
        public_url: string;
        payment_link_url: string | null;
      }>("create-invoice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
          customer_phone: customerPhone || undefined,
          tax_rate_bps: taxBps,
          due_at: dueAt ? new Date(dueAt).toISOString() : undefined,
          email_subject: emailSubject.trim() || undefined,
          customer_notes: customerNotes || undefined,
          internal_notes: internalNotes || undefined,
          items: cleanItems,
          ...(attachDoc && docTitle.trim() && docHtml.trim()
            ? { document: { title: docTitle, content_html: docHtml, required_after_payment: true } }
            : {}),
        }),
      });

      if (!created.payment_link_url) {
        toast.warning("Invoice created, but Stripe link not generated. Check STRIPE_SECRET_KEY.");
      } else {
        toast.success("Invoice created");
      }

      if (sendNow && created.payment_link_url) {
        const channels: ("email" | "sms")[] = [];
        if (sendEmail) channels.push("email");
        if (sendSms && customerPhone.trim()) channels.push("sms");
        if (channels.length > 0) {
          try {
            await callAdminFn("send-invoice", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ invoice_id: created.invoice_id, channels }),
            });
            toast.success("Invoice sent to customer");
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Send failed");
          }
        }
      }

      nav("/admin/invoices");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create invoice");
    } finally {
      setSubmitting(false);
    }
  };

  if (!sessionReady) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="mb-3 text-gray-700">You need to sign in.</p>
          <Button asChild>
            <Link to="/admin/invoices">Sign in</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-semibold">New invoice</h1>
          <Link to="/admin/invoices" className="text-sm text-gray-600 hover:text-gray-900 underline">
            ← All invoices
          </Link>
        </div>

        <div className="bg-white rounded-xl border p-6 space-y-6">
          {/* Customer */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Customer</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cn">Name</Label>
                <Input id="cn" value={customerName} onChange={(e) => setCustomerName(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="ce">Email</Label>
                <Input id="ce" type="email" value={customerEmail} onChange={(e) => setCustomerEmail(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="cp">Phone (E.164, e.g. +15125551234)</Label>
                <Input id="cp" value={customerPhone} onChange={(e) => setCustomerPhone(e.target.value)} placeholder="+1..." />
              </div>
              <div>
                <Label htmlFor="due">Due date</Label>
                <Input id="due" type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
              </div>
            </div>
          </section>

          {/* Items */}
          <section>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-semibold text-gray-700">Line items</h2>
              <button
                type="button"
                onClick={addItem}
                className="text-sm text-blue-700 hover:text-blue-900 underline"
              >
                + Add item
              </button>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => (
                <div key={i} className="grid grid-cols-12 gap-2 items-start">
                  <div className="col-span-12 sm:col-span-7">
                    <Input
                      placeholder="Description"
                      value={it.description}
                      onChange={(e) => updateItem(i, { description: e.target.value })}
                    />
                  </div>
                  <div className="col-span-4 sm:col-span-2">
                    <Input
                      placeholder="Qty"
                      inputMode="decimal"
                      value={it.quantity}
                      onChange={(e) => updateItem(i, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="col-span-6 sm:col-span-2">
                    <Input
                      placeholder="Unit price"
                      inputMode="decimal"
                      value={it.unit_price}
                      onChange={(e) => updateItem(i, { unit_price: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 sm:col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeItem(i)}
                      disabled={items.length === 1}
                      className="text-gray-400 hover:text-red-600 disabled:opacity-40 px-2"
                      aria-label="Remove item"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
              <div className="sm:col-start-3">
                <Label htmlFor="tax">Sales tax (%)</Label>
                <Input
                  id="tax"
                  inputMode="decimal"
                  value={taxPercent}
                  onChange={(e) => setTaxPercent(e.target.value)}
                  placeholder="8.25"
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  TX default: 8.25% ({fmtMoney(taxCents)})
                </p>
              </div>
              <div className="text-right">
                <div className="text-xs text-gray-500">Total</div>
                <div className="text-lg font-semibold tabular-nums">{fmtMoney(totalCents)}</div>
              </div>
            </div>
          </section>

          {/* Email subject + notes */}
          <section className="space-y-3">
            <div>
              <Label htmlFor="esubj">
                Email subject (optional)
              </Label>
              <Input
                id="esubj"
                value={emailSubject}
                onChange={(e) => setEmailSubject(e.target.value)}
                placeholder="e.g. invoice for Smith wedding 5/4/26"
              />
              <p className="text-[11px] text-gray-500 mt-1">
                Shown to the customer in the email subject. Leave blank for the default.
              </p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <Label htmlFor="cnotes">Note to customer (shown in email + invoice page)</Label>
                <Textarea id="cnotes" value={customerNotes} onChange={(e) => setCustomerNotes(e.target.value)} rows={3} />
              </div>
              <div>
                <Label htmlFor="inotes">Internal notes (not shared)</Label>
                <Textarea id="inotes" value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={3} />
              </div>
            </div>
          </section>

          {/* Document */}
          <section>
            <label className="flex items-center gap-2 mb-3">
              <Checkbox
                checked={attachDoc}
                onCheckedChange={(v) => setAttachDoc(v === true)}
                id="attachDoc"
              />
              <span className="text-sm font-medium">Attach document for customer to sign after payment</span>
            </label>
            {attachDoc && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="dt">Document title</Label>
                  <Input id="dt" value={docTitle} onChange={(e) => setDocTitle(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="dh">Document body (HTML)</Label>
                  <Textarea
                    id="dh"
                    value={docHtml}
                    onChange={(e) => setDocHtml(e.target.value)}
                    rows={8}
                    className="font-mono text-xs"
                  />
                </div>
              </div>
            )}
          </section>

          {/* Send options */}
          <section>
            <label className="flex items-center gap-2 mb-2">
              <Checkbox
                checked={sendNow}
                onCheckedChange={(v) => setSendNow(v === true)}
                id="sendNow"
              />
              <span className="text-sm font-medium">Send to customer immediately after creating</span>
            </label>
            {sendNow && (
              <div className="ml-6 flex flex-wrap gap-4 text-sm">
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={sendEmail}
                    onCheckedChange={(v) => setSendEmail(v === true)}
                    id="sendEmail"
                  />
                  Email
                </label>
                <label className="flex items-center gap-2">
                  <Checkbox
                    checked={sendSms}
                    onCheckedChange={(v) => setSendSms(v === true)}
                    id="sendSms"
                  />
                  SMS (Quo)
                </label>
              </div>
            )}
          </section>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" asChild>
              <Link to="/admin/invoices">Cancel</Link>
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting ? "Creating…" : sendNow ? "Create & send" : "Create draft"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
