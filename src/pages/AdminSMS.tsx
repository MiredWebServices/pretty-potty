import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Bot, BotOff, MessageSquare, Send, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import AdminNav from "@/components/AdminNav";
import { callAdminFn } from "@/lib/adminFn";
import { toast } from "sonner";

// New tables (sms_threads, sms_messages) are not yet in the generated
// `Database` types. Cast to a loose client for queries against them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as unknown as { from: (t: string) => any; channel: typeof supabase.channel; removeChannel: typeof supabase.removeChannel };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SmsThread {
  id: string;
  our_number: string;
  customer_number: string;
  display_name: string | null;
  bot_muted: boolean;
  bot_paused_until: string | null;
  last_inbound_at: string | null;
  last_outbound_at: string | null;
  ai_reply_count_24h: number;
  quo_conversation_id: string | null;
  next_ai_at: string | null;
  ai_reply_delay_seconds: number | null;
  updated_at: string;
}

interface SmsMessage {
  id: string;
  thread_id: string;
  direction: "inbound" | "outbound";
  role: "customer" | "ai" | "admin" | "system";
  body: string | null;
  status: string | null;
  ai_meta: Record<string, unknown> | null;
  created_at: string;
}

interface BusinessContext {
  id: number;
  services_md: string;
  pricing_md: string;
  policy_md: string;
  faq_md: string;
  greeting: string;
  timezone: string;
  quiet_hours_start: number;
  quiet_hours_end: number;
  max_ai_replies_per_24h: number;
  ai_reply_delay_seconds: number;
  auto_send_enabled: boolean;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fmtTime = (iso: string | null) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

const prettyPhone = (e164: string) => {
  const m = e164.match(/^\+1(\d{3})(\d{3})(\d{4})$/);
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
};

// ---------------------------------------------------------------------------

export default function AdminSMS() {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [threads, setThreads] = useState<SmsThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<SmsMessage[]>([]);
  const [contextOpen, setContextOpen] = useState(false);
  const [context, setContext] = useState<BusinessContext | null>(null);
  const [savingContext, setSavingContext] = useState(false);

  // ----- session -----
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // ----- threads -----
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const load = async () => {
      const { data, error } = await db
        .from("sms_threads")
        .select("*")
        .order("last_inbound_at", { ascending: false, nullsFirst: false })
        .limit(200);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      setThreads((data ?? []) as SmsThread[]);
      if (!activeThreadId && data?.length) setActiveThreadId(data[0].id);
    };
    load();
    const ch = supabase
      .channel("sms-threads")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sms_threads" },
        load,
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // ----- messages for active thread -----
  useEffect(() => {
    if (!session || !activeThreadId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      const { data, error } = await db
        .from("sms_messages")
        .select("*")
        .eq("thread_id", activeThreadId)
        .order("created_at", { ascending: true })
        .limit(500);
      if (cancelled) return;
      if (error) {
        toast.error(error.message);
        return;
      }
      setMessages((data ?? []) as SmsMessage[]);
    };
    load();
    const ch = supabase
      .channel(`sms-msg-${activeThreadId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "sms_messages",
          filter: `thread_id=eq.${activeThreadId}`,
        },
        load,
      )
      .subscribe();
    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [session, activeThreadId]);

  // ----- business context -----
  const openContext = async () => {
    try {
      const j = await callAdminFn<{ context: BusinessContext }>(
        "sms-admin",
        { method: "GET" },
        { action: "context" },
      );
      setContext(j.context);
      setContextOpen(true);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const saveContext = async () => {
    if (!context) return;
    setSavingContext(true);
    try {
      await callAdminFn(
        "sms-admin",
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(context),
        },
        { action: "context" },
      );
      toast.success("Saved");
      setContextOpen(false);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSavingContext(false);
    }
  };

  // ----- thread actions -----
  const toggleMute = async (t: SmsThread) => {
    try {
      await callAdminFn(
        "sms-admin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ thread_id: t.id, muted: !t.bot_muted }),
        },
        { action: "mute" },
      );
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const cancelPending = async (t: SmsThread) => {
    try {
      await callAdminFn(
        "sms-admin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ thread_id: t.id }),
        },
        { action: "cancel_pending" },
      );
      toast.success("AI reply cancelled");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const resumeBot = async (t: SmsThread) => {
    try {
      await callAdminFn(
        "sms-admin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ thread_id: t.id }),
        },
        { action: "resume" },
      );
      toast.success("Bot resumed for this thread");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const sendDraft = async (m: SmsMessage, override?: string) => {
    try {
      await callAdminFn(
        "sms-admin",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message_id: m.id, override_body: override }),
        },
        { action: "send_draft" },
      );
      toast.success("Sent");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const activeThread = useMemo(
    () => threads.find((t) => t.id === activeThreadId) ?? null,
    [threads, activeThreadId],
  );

  // ----- gate -----
  if (!sessionReady) return null;
  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <a href="/admin/inbox" className="underline text-sm">Sign in to access admin</a>
      </div>
    );
  }

  // ----- render -----
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <h1 className="font-serif text-xl flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> SMS auto-reply
          </h1>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={openContext}>
              <Settings className="h-4 w-4 mr-1" /> Business context
            </Button>
            <AdminNav
              email={session.user.email}
              onSignOut={async () => {
                await supabase.auth.signOut();
                setSession(null);
              }}
            />
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-4 grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
        {/* Threads list */}
        <aside className="border rounded-md bg-card overflow-hidden">
          <div className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground border-b">
            Conversations
          </div>
          {threads.length === 0 && (
            <div className="p-4 text-sm text-muted-foreground">
              No SMS threads yet. They'll appear here as customers text your Quo number.
            </div>
          )}
          <ul className="divide-y max-h-[70vh] overflow-y-auto">
            {threads.map((t) => {
              const active = t.id === activeThreadId;
              const paused =
                t.bot_paused_until && new Date(t.bot_paused_until).getTime() > Date.now();
              return (
                <li key={t.id}>
                  <button
                    onClick={() => setActiveThreadId(t.id)}
                    className={`w-full text-left px-3 py-2 text-sm flex flex-col gap-0.5 ${
                      active ? "bg-muted" : "hover:bg-muted/50"
                    }`}
                  >
                    <span className="flex items-center gap-2">
                      <span className="font-medium">
                        {t.display_name ?? prettyPhone(t.customer_number)}
                      </span>
                      {t.bot_muted && (
                        <span title="Bot muted"><BotOff className="h-3.5 w-3.5 text-muted-foreground" /></span>
                      )}
                      {paused && !t.bot_muted && (
                        <span className="text-[10px] text-amber-600 px-1 rounded bg-amber-50 border border-amber-200">paused</span>
                      )}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtTime(t.last_inbound_at)} · {t.ai_reply_count_24h} AI/24h
                      {t.next_ai_at && new Date(t.next_ai_at).getTime() > Date.now() && (
                        <span className="ml-1 text-amber-600">
                          · AI in {Math.max(0, Math.round((new Date(t.next_ai_at).getTime() - Date.now()) / 1000))}s
                        </span>
                      )}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </aside>

        {/* Thread view */}
        <section className="border rounded-md bg-card flex flex-col min-h-[60vh]">
          {!activeThread ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              Pick a thread.
            </div>
          ) : (
            <>
              <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">
                    {activeThread.display_name ?? prettyPhone(activeThread.customer_number)}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {prettyPhone(activeThread.customer_number)} · via {prettyPhone(activeThread.our_number)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activeThread.next_ai_at &&
                    new Date(activeThread.next_ai_at).getTime() > Date.now() && (
                      <Button size="sm" variant="outline" onClick={() => cancelPending(activeThread)}>
                        Cancel pending AI
                      </Button>
                    )}
                  {activeThread.bot_paused_until &&
                    new Date(activeThread.bot_paused_until).getTime() > Date.now() && (
                      <Button size="sm" variant="outline" onClick={() => resumeBot(activeThread)}>
                        Resume bot
                      </Button>
                    )}
                  <label className="flex items-center gap-2 text-sm">
                    <span className="text-muted-foreground">Bot</span>
                    <Switch
                      checked={!activeThread.bot_muted}
                      onCheckedChange={() => toggleMute(activeThread)}
                    />
                  </label>
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.map((m) => (
                  <MessageRow key={m.id} m={m} onSendDraft={sendDraft} />
                ))}
                {messages.length === 0 && (
                  <div className="text-sm text-muted-foreground">No messages yet.</div>
                )}
              </div>
              <div className="border-t px-4 py-2 text-xs text-muted-foreground">
                Reply directly from your Quo dashboard. Anything you send there pauses the bot for 24h on this thread.
              </div>
            </>
          )}
        </section>
      </div>

      {/* Business context modal */}
      <Dialog open={contextOpen} onOpenChange={setContextOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Business context for AI replies</DialogTitle>
          </DialogHeader>
          {context && (
            <div className="space-y-4">
              <ContextField
                label="Services"
                hint="What you offer. Drives intent classification."
                value={context.services_md}
                onChange={(v) => setContext({ ...context, services_md: v })}
              />
              <ContextField
                label="Pricing"
                hint="Pricing rules. The AI will NEVER quote firm prices, only relay this language."
                value={context.pricing_md}
                onChange={(v) => setContext({ ...context, pricing_md: v })}
              />
              <ContextField
                label="Policy & service area"
                value={context.policy_md}
                onChange={(v) => setContext({ ...context, policy_md: v })}
              />
              <ContextField
                label="FAQ"
                hint="Q/A pairs the AI may answer directly."
                value={context.faq_md}
                onChange={(v) => setContext({ ...context, faq_md: v })}
              />
              <div>
                <Label>Greeting (first AI reply)</Label>
                <Input
                  value={context.greeting}
                  onChange={(e) => setContext({ ...context, greeting: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <Label>Timezone</Label>
                  <Input
                    value={context.timezone}
                    onChange={(e) => setContext({ ...context, timezone: e.target.value })}
                  />
                </div>
                <div>
                  <Label>Quiet start (hr)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={context.quiet_hours_start}
                    onChange={(e) =>
                      setContext({ ...context, quiet_hours_start: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Quiet end (hr)</Label>
                  <Input
                    type="number"
                    min={0}
                    max={23}
                    value={context.quiet_hours_end}
                    onChange={(e) =>
                      setContext({ ...context, quiet_hours_end: Number(e.target.value) })
                    }
                  />
                </div>
                <div>
                  <Label>Max AI/24h</Label>
                  <Input
                    type="number"
                    min={0}
                    max={20}
                    value={context.max_ai_replies_per_24h}
                    onChange={(e) =>
                      setContext({ ...context, max_ai_replies_per_24h: Number(e.target.value) })
                    }
                  />
                </div>
              </div>
              <div>
                <Label>Auto-reply delay (seconds)</Label>
                <p className="text-xs text-muted-foreground mb-1">
                  How long to wait after a customer texts before the AI replies. Lets you jump in first from the Quo dashboard. Default 120 (2 min). Set to 0 to reply immediately.
                </p>
                <Input
                  type="number"
                  min={0}
                  max={1800}
                  value={context.ai_reply_delay_seconds}
                  onChange={(e) =>
                    setContext({ ...context, ai_reply_delay_seconds: Number(e.target.value) })
                  }
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={context.auto_send_enabled}
                  onCheckedChange={(v) => setContext({ ...context, auto_send_enabled: v })}
                />
                <span>Auto-send enabled (master toggle)</span>
              </label>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setContextOpen(false)}>Cancel</Button>
            <Button onClick={saveContext} disabled={savingContext}>
              {savingContext ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------

function ContextField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <Label>{label}</Label>
      {hint && <p className="text-xs text-muted-foreground mb-1">{hint}</p>}
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        className="font-mono text-xs"
      />
    </div>
  );
}

function MessageRow({
  m,
  onSendDraft,
}: {
  m: SmsMessage;
  onSendDraft: (m: SmsMessage, override?: string) => void | Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(m.body ?? "");

  if (m.role === "system") {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        [{new Date(m.created_at).toLocaleTimeString()}]{" "}
        {String((m.ai_meta as { skipped?: string })?.skipped ?? "system")}
        {(m.ai_meta as { error?: string })?.error
          ? ` — ${(m.ai_meta as { error: string }).error}`
          : ""}
      </div>
    );
  }

  const isInbound = m.direction === "inbound";
  const isDraft = m.role === "ai" && m.status === "draft";
  const meta = (m.ai_meta ?? {}) as { intent?: string; confidence?: number; reason?: string };

  return (
    <div className={`flex ${isInbound ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
          isInbound
            ? "bg-muted"
            : isDraft
              ? "border border-amber-300 bg-amber-50"
              : m.role === "admin"
                ? "bg-primary text-primary-foreground"
                : "bg-blue-50 border border-blue-200"
        }`}
      >
        {!isInbound && (
          <div className="text-[10px] uppercase tracking-wide opacity-70 flex items-center gap-1">
            {m.role === "ai" ? <Bot className="h-3 w-3" /> : null}
            {m.role}{isDraft ? " · draft" : ""}
            {meta.intent ? ` · ${meta.intent}` : ""}
            {typeof meta.confidence === "number" ? ` · ${(meta.confidence * 100).toFixed(0)}%` : ""}
          </div>
        )}
        {editing ? (
          <Textarea
            rows={3}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            className="text-sm bg-background"
          />
        ) : (
          <div className="whitespace-pre-wrap">{m.body ?? "(empty)"}</div>
        )}
        <div className="text-[10px] mt-1 opacity-60">
          {new Date(m.created_at).toLocaleTimeString()}
        </div>
        {isDraft && (
          <div className="mt-2 flex gap-2">
            {editing ? (
              <>
                <Button size="sm" onClick={() => onSendDraft(m, body)}>
                  <Send className="h-3 w-3 mr-1" /> Send edited
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
              </>
            ) : (
              <>
                <Button size="sm" onClick={() => onSendDraft(m)}>
                  <Send className="h-3 w-3 mr-1" /> Send as-is
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditing(true)}>Edit</Button>
              </>
            )}
          </div>
        )}
        {meta.reason && !isInbound && (
          <div className="text-[10px] mt-1 opacity-60 italic">{meta.reason}</div>
        )}
      </div>
    </div>
  );
}
