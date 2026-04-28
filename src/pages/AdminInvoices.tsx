import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { callAdminFn } from "@/lib/adminFn";
import AdminNav from "@/components/AdminNav";
import { toast } from "sonner";

interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  total_cents: number;
  currency: string;
  status: string;
  issued_at: string | null;
  due_at: string | null;
  paid_at: string | null;
  created_at: string;
  public_token: string;
  stripe_payment_link_url: string | null;
  last_reminder_at: string | null;
  reminder_count: number;
}

const fmtMoney = (cents: number, currency: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );

const STATUSES = ["all", "draft", "sent", "viewed", "overdue", "paid", "signed", "void"] as const;

const statusColor: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  sent: "bg-amber-100 text-amber-800",
  viewed: "bg-amber-100 text-amber-800",
  overdue: "bg-red-100 text-red-800",
  paid: "bg-emerald-100 text-emerald-800",
  signed: "bg-emerald-100 text-emerald-800",
  void: "bg-gray-200 text-gray-600",
};

export default function AdminInvoices() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [statusFilter, setStatusFilter] = useState<typeof STATUSES[number]>("all");
  const [search, setSearch] = useState("");
  const [searchDebounced, setSearchDebounced] = useState("");

  // ---------- session ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setSearchDebounced(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // ---------- list ----------
  const load = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setForbidden(false);
    try {
      const params: Record<string, string> = { action: "list", status: statusFilter };
      if (searchDebounced) params.q = searchDebounced;
      const { invoices } = await callAdminFn<{ invoices: InvoiceRow[] }>(
        "list-invoices",
        { method: "GET" },
        params,
      );
      setInvoices(invoices ?? []);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 403) setForbidden(true);
      else toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [session, statusFilter, searchDebounced]);

  useEffect(() => {
    load();
  }, [load]);

  const sendInvoice = async (id: string, channels: ("email" | "sms")[], reminder = false) => {
    try {
      const r = await callAdminFn<{ ok: boolean; results: Record<string, { ok: boolean; error?: string }> }>(
        "send-invoice",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ invoice_id: id, channels, reminder }),
        },
      );
      const failed = Object.entries(r.results)
        .filter(([, v]) => !v.ok)
        .map(([k, v]) => `${k}: ${v.error}`);
      if (failed.length === 0) toast.success(reminder ? "Reminder sent" : "Invoice sent");
      else toast.warning(`Partial: ${failed.join(", ")}`);
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Send failed");
    }
  };

  const voidInvoice = async (id: string) => {
    if (!confirm("Void this invoice? Customers won't be able to pay it anymore.")) return;
    try {
      await callAdminFn("list-invoices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "void", id }),
      }, { action: "void" });
      toast.success("Invoice voided");
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  const copyLink = async (token: string) => {
    const url = `${window.location.origin}/i/${token}`;
    await navigator.clipboard.writeText(url);
    toast.success("Link copied");
  };

  // ---------- auth gates ----------
  if (!sessionReady) {
    return <div className="min-h-screen flex items-center justify-center text-gray-500">Loading…</div>;
  }
  if (!session) {
    const signIn = async () => {
      setSigningIn(true);
      try {
        const { error } = await supabase.auth.signInWithPassword({
          email: emailInput.trim(),
          password: passwordInput,
        });
        if (error) toast.error(error.message);
      } finally {
        setSigningIn(false);
      }
    };
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="w-full max-w-sm bg-white p-6 rounded-xl shadow-sm border">
          <h1 className="text-xl font-semibold mb-4">Admin sign in</h1>
          <div className="space-y-3">
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={emailInput} onChange={(e) => setEmailInput(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="password">Password</Label>
              <Input id="password" type="password" value={passwordInput} onChange={(e) => setPasswordInput(e.target.value)} />
            </div>
            <Button className="w-full" onClick={signIn} disabled={signingIn}>
              {signingIn ? "Signing in…" : "Sign in"}
            </Button>
          </div>
        </div>
      </div>
    );
  }
  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-xl font-semibold">Not authorized</h1>
          <p className="text-gray-600 mt-2">Your account isn't on the admin allowlist.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <div className="mb-6">
          <AdminNav
            email={session.user.email}
            onSignOut={() => supabase.auth.signOut()}
          />
        </div>
        <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Invoices</h1>
            <p className="text-sm text-gray-600 mt-1">
              Create, send, and track payment + signature for invoices.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild>
              <Link to="/admin/invoices/new">+ New invoice</Link>
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 mb-4">
          {STATUSES.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-full text-sm border ${
                statusFilter === s
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-gray-700 border-gray-200 hover:border-gray-300"
              }`}
            >
              {s}
            </button>
          ))}
          <div className="ml-auto w-full sm:w-72">
            <Input
              placeholder="Search number, name, or email…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>

        <div className="bg-white border rounded-xl overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-gray-500">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="p-12 text-center text-gray-500">No invoices yet.</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-xs uppercase text-gray-500">
                <tr>
                  <th className="text-left px-4 py-2">Invoice</th>
                  <th className="text-left px-4 py-2">Customer</th>
                  <th className="text-right px-4 py-2">Total</th>
                  <th className="text-left px-4 py-2">Status</th>
                  <th className="text-left px-4 py-2 hidden md:table-cell">Created</th>
                  <th className="text-right px-4 py-2">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((inv) => (
                  <tr key={inv.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium">{inv.invoice_number}</td>
                    <td className="px-4 py-3">
                      <div>{inv.customer_name}</div>
                      <div className="text-xs text-gray-500">{inv.customer_email}</div>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {fmtMoney(inv.total_cents, inv.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${statusColor[inv.status] ?? "bg-gray-100 text-gray-700"}`}>
                        {inv.status}
                      </span>
                      {inv.reminder_count > 0 && (
                        <span className="ml-2 text-xs text-gray-500">
                          {inv.reminder_count} reminder{inv.reminder_count > 1 ? "s" : ""}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-gray-600">
                      {new Date(inv.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2 flex-wrap">
                        <button
                          onClick={() => copyLink(inv.public_token)}
                          className="text-xs text-gray-600 hover:text-gray-900 underline"
                        >
                          Copy link
                        </button>
                        {inv.status === "draft" && (
                          <button
                            onClick={() => sendInvoice(inv.id, ["email", "sms"])}
                            className="text-xs text-blue-700 hover:text-blue-900 underline"
                          >
                            Send
                          </button>
                        )}
                        {(inv.status === "sent" ||
                          inv.status === "viewed" ||
                          inv.status === "overdue") && (
                          <button
                            onClick={() => sendInvoice(inv.id, ["email", "sms"], true)}
                            className="text-xs text-amber-700 hover:text-amber-900 underline"
                          >
                            Remind
                          </button>
                        )}
                        {inv.status !== "paid" &&
                          inv.status !== "signed" &&
                          inv.status !== "void" && (
                            <button
                              onClick={() => voidInvoice(inv.id)}
                              className="text-xs text-red-700 hover:text-red-900 underline"
                            >
                              Void
                            </button>
                          )}
                        <a
                          href={`/i/${inv.public_token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-gray-600 hover:text-gray-900 underline"
                        >
                          View
                        </a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
