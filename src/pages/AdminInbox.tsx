import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { toast } from "sonner";

// ---------- types ----------

interface AttachmentMeta {
  id: string;
  filename: string;
  content_type: string;
}

interface InboundListItem {
  id: string;
  resend_email_id: string;
  from_address: string;
  to_addresses: string[];
  subject: string | null;
  received_at: string;
  read_at: string | null;
  archived_at: string | null;
  attachments: AttachmentMeta[];
}

interface InboundDetail extends InboundListItem {
  cc_addresses: string[];
  bcc_addresses: string[];
  message_id: string | null;
  text_body: string | null;
  html_body: string | null;
}

interface SentItem {
  id: string;
  inbound_email_id: string | null;
  from_address: string;
  to_addresses: string[];
  subject: string | null;
  body_text: string | null;
  sent_by: string;
  created_at: string;
}

interface SentDetail extends SentItem {
  body_html: string | null;
  in_reply_to: string | null;
  resend_email_id: string | null;
}

interface ThreadInbound {
  id: string;
  from_address: string;
  subject: string | null;
  received_at: string;
  text_body: string | null;
  html_body: string | null;
}

interface ThreadReply {
  id: string;
  inbound_email_id: string | null;
  from_address: string;
  to_addresses: string[];
  subject: string | null;
  body_text: string | null;
  body_html: string | null;
  sent_by: string;
  created_at: string;
}

interface Thread {
  inbounds: ThreadInbound[];
  replies: ThreadReply[];
}

// ---------- helpers ----------

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ??
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) as string;

const parseAddress = (raw: string): { name: string; email: string } => {
  const m = raw.match(/^\s*(.*?)\s*<\s*([^<>]+?)\s*>\s*$/);
  if (m) return { name: m[1].replace(/^"|"$/g, "").trim() || m[2], email: m[2] };
  return { name: raw, email: raw };
};

const formatDate = (iso: string) => {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString([], {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
};

const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024; // 20MB total

const formatBytes = (n: number) => {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
};

// Read a File as base64 (without the data: URL prefix). Used to attach files
// to outbound emails via Resend.
const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });

const buildQuotedReply = (email: InboundDetail): string => {
  const { name } = parseAddress(email.from_address);
  const date = new Date(email.received_at).toLocaleString();
  const original = (email.text_body ?? email.html_body ?? "")
    .replace(/<[^>]+>/g, "") // strip tags if we only have html
    .trim();
  const quoted = original
    .split("\n")
    .map((line) => `> ${line}`)
    .join("\n");
  return `\n\nOn ${date}, ${name} wrote:\n${quoted}\n`;
};

// ---------- page ----------

const AdminInbox = () => {
  // Auth
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [passwordInput, setPasswordInput] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [resetSent, setResetSent] = useState(false);

  const [recoveryMode, setRecoveryMode] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [updatingPassword, setUpdatingPassword] = useState(false);

  // List
  const [emails, setEmails] = useState<InboundListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState(""); // debounced
  const [view, setView] = useState<"inbox" | "archived" | "sent">("inbox");

  // Detail + thread
  const [selected, setSelected] = useState<InboundDetail | null>(null);
  const [thread, setThread] = useState<Thread>({ inbounds: [], replies: [] });
  const [selectedLoading, setSelectedLoading] = useState(false);

  // Sent
  const [sentEmails, setSentEmails] = useState<SentItem[]>([]);
  const [selectedSent, setSelectedSent] = useState<SentDetail | null>(null);

  // Reply composer
  const [replyBody, setReplyBody] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [replyFiles, setReplyFiles] = useState<File[]>([]);
  const replyFileInputRef = useRef<HTMLInputElement | null>(null);
  const replyImageInputRef = useRef<HTMLInputElement | null>(null);
  const replyTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Compose new
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTo, setComposeTo] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeSending, setComposeSending] = useState(false);
  const [composeFiles, setComposeFiles] = useState<File[]>([]);
  const composeFileInputRef = useRef<HTMLInputElement | null>(null);
  const composeImageInputRef = useRef<HTMLInputElement | null>(null);
  const composeTextareaRef = useRef<HTMLTextAreaElement | null>(null);

  const titleBase = "Admin Inbox";
  const sessionRef = useRef<Session | null>(null);
  sessionRef.current = session;

  // ---------- session ----------
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setSessionReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === "PASSWORD_RECOVERY") setRecoveryMode(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // ---------- fetch helpers ----------
  const fnUrl = (path: string, params?: Record<string, string>) => {
    const u = new URL(`${SUPABASE_URL}/functions/v1/${path}`);
    if (params) Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    return u.toString();
  };

  const callFn = useCallback(
    async (path: string, init: RequestInit = {}, params?: Record<string, string>) => {
      const s = sessionRef.current;
      if (!s) throw new Error("Not signed in");
      const res = await fetch(fnUrl(path, params), {
        ...init,
        headers: {
          ...(init.headers ?? {}),
          Authorization: `Bearer ${s.access_token}`,
          apikey: ANON_KEY,
        },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const err = new Error((data as { error?: string })?.error ?? `HTTP ${res.status}`);
        (err as Error & { status?: number }).status = res.status;
        throw err;
      }
      return data;
    },
    [],
  );

  // ---------- list ----------
  const loadList = useCallback(async () => {
    if (!sessionRef.current) return;
    setLoading(true);
    setForbidden(false);
    try {
      if (view === "sent") {
        const params: Record<string, string> = { action: "list_sent" };
        if (searchQuery) params.q = searchQuery;
        const { emails } = await callFn("list-inbound-emails", { method: "GET" }, params);
        setSentEmails(emails ?? []);
      } else {
        const params: Record<string, string> = {
          action: "list",
          archived: view === "archived" ? "true" : "false",
        };
        if (searchQuery) params.q = searchQuery;
        const { emails } = await callFn("list-inbound-emails", { method: "GET" }, params);
        setEmails(emails ?? []);
      }
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 403) setForbidden(true);
      else toast.error(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [callFn, searchQuery, view]);

  useEffect(() => {
    if (session) loadList();
  }, [session?.access_token, loadList, view, searchQuery]);

  // ---------- search debounce ----------
  useEffect(() => {
    const t = setTimeout(() => setSearchQuery(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  // ---------- realtime ----------
  useEffect(() => {
    if (!session) return;
    const channel = supabase
      .channel("inbound-emails")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "inbound_emails" },
        (payload) => {
          const row = payload.new as InboundListItem;
          // Only show in the inbox view if it's not archived.
          if (view === "inbox" && !row.archived_at) {
            setEmails((prev) => {
              if (prev.some((e) => e.id === row.id)) return prev;
              return [row, ...prev];
            });
          }
          // Browser notification if tab is hidden.
          if (document.hidden && "Notification" in window && Notification.permission === "granted") {
            const { name } = parseAddress(row.from_address);
            new Notification(`New email from ${name}`, {
              body: row.subject ?? "(no subject)",
              tag: row.id,
            });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [session, view]);

  // ---------- request notification permission once on first sign-in ----------
  useEffect(() => {
    if (!session) return;
    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {
        /* ignore */
      });
    }
  }, [session]);

  // ---------- tab title badge ----------
  const unreadCount = useMemo(() => emails.filter((e) => !e.read_at).length, [emails]);
  useEffect(() => {
    document.title = unreadCount > 0 ? `(${unreadCount}) ${titleBase}` : titleBase;
    return () => {
      document.title = titleBase;
    };
  }, [unreadCount]);

  // ---------- sent detail ----------
  const openSent = async (id: string) => {
    setSelectedLoading(true);
    setSelected(null);
    setSelectedSent(null);
    setThread({ inbounds: [], replies: [] });
    try {
      const { reply } = await callFn(
        "list-inbound-emails",
        { method: "GET" },
        { action: "get_sent", id },
      );
      // If this reply has a parent inbound, open the inbound thread so the
      // admin can see the full conversation. Otherwise show the reply alone.
      if (reply?.inbound_email_id) {
        const { email, thread } = await callFn(
          "list-inbound-emails",
          { method: "GET" },
          { action: "get", id: reply.inbound_email_id },
        );
        setSelected(email);
        setThread(thread ?? { inbounds: [], replies: [] });
      } else {
        setSelectedSent(reply);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load email");
    } finally {
      setSelectedLoading(false);
    }
  };

  // ---------- email detail ----------
  const openEmail = async (id: string) => {
    setSelectedLoading(true);
    setSelected(null);
    setSelectedSent(null);
    setThread({ inbounds: [], replies: [] });
    setReplyBody("");
    try {
      const { email, thread } = await callFn(
        "list-inbound-emails",
        { method: "GET" },
        { action: "get", id },
      );
      setSelected(email);
      setThread(thread ?? { inbounds: [], replies: [] });
      setEmails((prev) =>
        prev.map((e) => (e.id === id ? { ...e, read_at: email.read_at ?? new Date().toISOString() } : e)),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load email");
    } finally {
      setSelectedLoading(false);
    }
  };

  // ---------- reply ----------
  const sendReply = async () => {
    if (!selected || !replyBody.trim() || !session) return;
    const totalBytes = replyFiles.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachments exceed 20MB total.");
      return;
    }
    setSendingReply(true);
    try {
      const attachments = await Promise.all(
        replyFiles.map(async (f) => ({
          filename: f.name,
          content: await fileToBase64(f),
          content_type: f.type || "application/octet-stream",
        })),
      );
      await callFn("send-admin-reply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          inbound_email_id: selected.id,
          body: replyBody,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });
      toast.success(`Reply sent to ${parseAddress(selected.from_address).name}`);
      setReplyBody("");
      setReplyFiles([]);
      if (replyFileInputRef.current) replyFileInputRef.current.value = "";
      // Refresh thread to include the new reply.
      openEmail(selected.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send reply");
    } finally {
      setSendingReply(false);
    }
  };

  const addReplyFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setReplyFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeReplyFile = (idx: number) => {
    setReplyFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  // Insert image attachments at the textarea cursor as `[image: filename]`
  // markers. The edge function replaces these markers with actual inline images.
  const insertReplyImagesAtCursor = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setReplyFiles((prev) => [...prev, ...list]);
    const markers = list.map((f) => `[image: ${f.name}]`).join("\n");
    const ta = replyTextareaRef.current;
    if (!ta) {
      setReplyBody((prev) => prev + (prev && !prev.endsWith("\n") ? "\n" : "") + markers);
      return;
    }
    const start = ta.selectionStart ?? replyBody.length;
    const end = ta.selectionEnd ?? replyBody.length;
    const next = replyBody.slice(0, start) + markers + replyBody.slice(end);
    setReplyBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + markers.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  const insertQuotedOriginal = () => {
    if (!selected) return;
    setReplyBody((prev) => prev + buildQuotedReply(selected));
  };

  // ---------- archive ----------
  const archiveSelected = async (archive: boolean) => {
    if (!selected) return;
    try {
      await callFn(
        "list-inbound-emails",
        { method: "GET" },
        { action: archive ? "archive" : "unarchive", id: selected.id },
      );
      toast.success(archive ? "Archived" : "Restored");
      setEmails((prev) => prev.filter((e) => e.id !== selected.id));
      setSelected(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed");
    }
  };

  // ---------- compose new ----------
  const sendCompose = async () => {
    const to = composeTo
      .split(/[,;]/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (to.length === 0 || !composeSubject.trim() || !composeBody.trim()) {
      toast.error("To, subject, and body are required.");
      return;
    }
    const totalBytes = composeFiles.reduce((s, f) => s + f.size, 0);
    if (totalBytes > MAX_ATTACHMENT_BYTES) {
      toast.error("Attachments exceed 20MB total.");
      return;
    }
    setComposeSending(true);
    try {
      const attachments = await Promise.all(
        composeFiles.map(async (f) => ({
          filename: f.name,
          content: await fileToBase64(f),
          content_type: f.type || "application/octet-stream",
        })),
      );
      await callFn("send-admin-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to,
          subject: composeSubject,
          body: composeBody,
          ...(attachments.length > 0 ? { attachments } : {}),
        }),
      });
      toast.success(`Email sent to ${to.join(", ")}`);
      setComposeOpen(false);
      setComposeTo("");
      setComposeSubject("");
      setComposeBody("");
      setComposeFiles([]);
      if (composeFileInputRef.current) composeFileInputRef.current.value = "";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setComposeSending(false);
    }
  };

  const addComposeFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setComposeFiles((prev) => [...prev, ...Array.from(files)]);
  };

  const removeComposeFile = (idx: number) => {
    setComposeFiles((prev) => prev.filter((_, i) => i !== idx));
  };

  const insertComposeImagesAtCursor = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setComposeFiles((prev) => [...prev, ...list]);
    const markers = list.map((f) => `[image: ${f.name}]`).join("\n");
    const ta = composeTextareaRef.current;
    if (!ta) {
      setComposeBody((prev) => prev + (prev && !prev.endsWith("\n") ? "\n" : "") + markers);
      return;
    }
    const start = ta.selectionStart ?? composeBody.length;
    const end = ta.selectionEnd ?? composeBody.length;
    const next = composeBody.slice(0, start) + markers + composeBody.slice(end);
    setComposeBody(next);
    requestAnimationFrame(() => {
      ta.focus();
      const pos = start + markers.length;
      ta.setSelectionRange(pos, pos);
    });
  };

  // ---------- attachment download ----------
  const downloadAttachment = async (attachmentId: string, filename: string) => {
    if (!selected || !session) return;
    try {
      const res = await fetch(
        fnUrl("download-attachment", {
          inbound_email_id: selected.id,
          attachment_id: attachmentId,
        }),
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: ANON_KEY,
          },
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Download failed");
    }
  };

  // ---------- auth handlers ----------
  const signIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim() || !passwordInput) return;
    setSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: emailInput.trim(),
        password: passwordInput,
      });
      if (error) throw error;
      setPasswordInput("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setSigningIn(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!emailInput.trim()) return toast.error("Enter your email first.");
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(emailInput.trim(), {
        redirectTo: `${window.location.origin}/admin/inbox`,
      });
      if (error) throw error;
      setResetSent(true);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't send reset email");
    }
  };

  const updatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) return toast.error("Password must be at least 8 characters.");
    setUpdatingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      toast.success("Password updated.");
      setNewPassword("");
      setRecoveryMode(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't update password");
    } finally {
      setUpdatingPassword(false);
    }
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setEmails([]);
    setSelected(null);
    setForbidden(false);
    setResetSent(false);
    setRecoveryMode(false);
  };

  // ---------- screens ----------
  if (!sessionReady) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading…</p>
      </div>
    );
  }

  if (recoveryMode && session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <form className="w-full max-w-sm space-y-4 p-8 border rounded-lg bg-card" onSubmit={updatePassword}>
          <h1 className="font-serif text-2xl">Set a new password</h1>
          <p className="text-sm text-muted-foreground">
            Signed in as <strong>{session.user.email}</strong>. Choose a new password.
          </p>
          <div>
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={updatingPassword}>
            {updatingPassword ? "Saving…" : "Save password"}
          </Button>
        </form>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <form className="w-full max-w-sm space-y-4 p-8 border rounded-lg bg-card" onSubmit={signIn}>
          <h1 className="font-serif text-2xl">Admin Inbox</h1>
          <p className="text-sm text-muted-foreground">Sign in with your authorized email and password.</p>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full" disabled={signingIn}>
            {signingIn ? "Signing in…" : "Sign in"}
          </Button>
          {resetSent ? (
            <p className="text-xs text-muted-foreground text-center">
              Reset email sent to <strong>{emailInput}</strong>. Check your inbox.
            </p>
          ) : (
            <button
              type="button"
              onClick={sendPasswordReset}
              className="text-xs text-muted-foreground hover:text-foreground underline w-full text-center"
            >
              Forgot password / set initial password
            </button>
          )}
        </form>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-full max-w-sm space-y-4 p-8 border rounded-lg bg-card text-center">
          <h1 className="font-serif text-2xl">Not authorized</h1>
          <p className="text-sm text-muted-foreground">
            <strong>{session.user.email}</strong> is not on the admin allowlist.
          </p>
          <Button variant="outline" onClick={signOut} className="w-full">
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // ---------- main inbox ----------
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container-tight py-4 flex flex-wrap items-center gap-3 justify-between">
          <div>
            <h1 className="font-serif text-2xl">Admin Inbox</h1>
            <p className="text-xs text-muted-foreground">
              {session.user.email} ·{" "}
              {view === "sent"
                ? `${sentEmails.length} sent email${sentEmails.length === 1 ? "" : "s"}`
                : `${emails.length} email${emails.length === 1 ? "" : "s"} · ${unreadCount} unread`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Input
              type="search"
              placeholder="Search subject, sender, body…"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              className="w-64"
            />
            <div className="flex rounded-md border overflow-hidden text-xs">
              <button
                type="button"
                onClick={() => setView("inbox")}
                className={`px-3 py-1.5 ${view === "inbox" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                Inbox
              </button>
              <button
                type="button"
                onClick={() => setView("sent")}
                className={`px-3 py-1.5 border-l ${view === "sent" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                Sent
              </button>
              <button
                type="button"
                onClick={() => setView("archived")}
                className={`px-3 py-1.5 border-l ${view === "archived" ? "bg-primary text-primary-foreground" : "bg-background"}`}
              >
                Archived
              </button>
            </div>
            <Button size="sm" onClick={() => setComposeOpen(true)}>
              Compose
            </Button>
            <Button variant="outline" size="sm" onClick={loadList} disabled={loading}>
              {loading ? "…" : "Refresh"}
            </Button>
            <AdminNav email={session.user.email} onSignOut={signOut} />
          </div>
        </div>
      </header>

      <main className="container-tight py-6 grid gap-4 md:grid-cols-[360px_1fr]">
        <aside className="border rounded-lg overflow-hidden bg-card">
          {view === "sent" ? (
            <>
              {sentEmails.length === 0 && !loading && (
                <div className="p-6 text-sm text-muted-foreground">
                  {searchQuery ? "No matches." : "No sent emails yet."}
                </div>
              )}
              <ul className="divide-y max-h-[75vh] overflow-y-auto">
                {sentEmails.map((e) => {
                  const isSelected =
                    selectedSent?.id === e.id ||
                    (e.inbound_email_id != null && selected?.id === e.inbound_email_id);
                  const recipients = e.to_addresses
                    .map((a) => parseAddress(a).name)
                    .join(", ");
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => openSent(e.id)}
                        className={`w-full text-left p-4 hover:bg-accent transition-colors ${isSelected ? "bg-accent" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm truncate">
                            <span className="text-muted-foreground">To: </span>
                            {recipients || "(no recipient)"}
                          </span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDate(e.created_at)}
                          </span>
                        </div>
                        <div className="text-sm truncate text-muted-foreground">
                          {e.subject || "(no subject)"}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          ) : (
            <>
              {emails.length === 0 && !loading && (
                <div className="p-6 text-sm text-muted-foreground">
                  {view === "archived" ? "No archived emails." : searchQuery ? "No matches." : "No emails yet."}
                </div>
              )}
              <ul className="divide-y max-h-[75vh] overflow-y-auto">
                {emails.map((e) => {
                  const isSelected = selected?.id === e.id;
                  const unread = !e.read_at;
                  const { name } = parseAddress(e.from_address);
                  return (
                    <li key={e.id}>
                      <button
                        type="button"
                        onClick={() => openEmail(e.id)}
                        className={`w-full text-left p-4 hover:bg-accent transition-colors ${isSelected ? "bg-accent" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className={`text-sm truncate ${unread ? "font-semibold" : ""}`}>{name}</span>
                          <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                            {formatDate(e.received_at)}
                          </span>
                        </div>
                        <div className={`text-sm truncate ${unread ? "font-medium" : "text-muted-foreground"}`}>
                          {e.subject || "(no subject)"}
                        </div>
                        {e.attachments?.length > 0 && (
                          <div className="text-[10px] text-muted-foreground mt-1">
                            📎 {e.attachments.length} attachment{e.attachments.length === 1 ? "" : "s"}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>

        <section className="border rounded-lg bg-card p-6 min-h-[60vh]">
          {selectedLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!selectedLoading && !selected && !selectedSent && (
            <p className="text-sm text-muted-foreground">Select an email to read.</p>
          )}
          {!selectedLoading && selectedSent && (
            <article className="space-y-4">
              <header className="space-y-1 border-b pb-4">
                <h2 className="font-serif text-xl break-words">
                  {selectedSent.subject || "(no subject)"}
                </h2>
                <p className="text-sm">
                  <span className="text-muted-foreground">From: </span>
                  <strong>{parseAddress(selectedSent.from_address).name}</strong>{" "}
                  <span className="text-muted-foreground">
                    &lt;{parseAddress(selectedSent.from_address).email}&gt;
                  </span>
                </p>
                <p className="text-sm text-muted-foreground">
                  To: {selectedSent.to_addresses.join(", ")}
                </p>
                <p className="text-xs text-muted-foreground">
                  Sent {new Date(selectedSent.created_at).toLocaleString()} by {selectedSent.sent_by}
                </p>
              </header>
              {selectedSent.body_html ? (
                <iframe
                  title="sent-body"
                  sandbox=""
                  srcDoc={selectedSent.body_html}
                  className="w-full min-h-[300px] border rounded bg-white"
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-sans">
                  {selectedSent.body_text || "(no body)"}
                </pre>
              )}
            </article>
          )}
          {selected && (
            <article className="space-y-4">
              <header className="space-y-1 border-b pb-4 flex items-start justify-between gap-4">
                <div className="space-y-1 min-w-0">
                  <h2 className="font-serif text-xl break-words">{selected.subject || "(no subject)"}</h2>
                  <p className="text-sm">
                    <strong>{parseAddress(selected.from_address).name}</strong>{" "}
                    <span className="text-muted-foreground">&lt;{parseAddress(selected.from_address).email}&gt;</span>
                  </p>
                  <p className="text-sm text-muted-foreground">
                    To: {selected.to_addresses.join(", ")}
                    {selected.cc_addresses?.length > 0 && <> · Cc: {selected.cc_addresses.join(", ")}</>}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(selected.received_at).toLocaleString()}
                  </p>
                </div>
                <div className="shrink-0">
                  {view === "archived" ? (
                    <Button variant="outline" size="sm" onClick={() => archiveSelected(false)}>
                      Restore
                    </Button>
                  ) : view === "inbox" ? (
                    <Button variant="outline" size="sm" onClick={() => archiveSelected(true)}>
                      Archive
                    </Button>
                  ) : null}
                </div>
              </header>

              {selected.html_body ? (
                <iframe
                  title="email-body"
                  sandbox=""
                  srcDoc={selected.html_body}
                  className="w-full min-h-[300px] border rounded bg-white"
                />
              ) : (
                <pre className="whitespace-pre-wrap text-sm font-sans">{selected.text_body || "(no body)"}</pre>
              )}

              {selected.attachments?.length > 0 && (
                <div className="border-t pt-4">
                  <h3 className="text-sm font-semibold mb-2">Attachments</h3>
                  <ul className="text-sm space-y-1">
                    {selected.attachments.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => downloadAttachment(a.id, a.filename)}
                          className="text-primary hover:underline"
                        >
                          📎 {a.filename}
                        </button>{" "}
                        <span className="text-muted-foreground text-xs">({a.content_type})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Thread: prior inbounds and replies */}
              {(thread.inbounds.filter((i) => i.id !== selected.id).length > 0 || thread.replies.length > 0) && (
                <div className="border-t pt-4 space-y-4">
                  <h3 className="text-sm font-semibold">Conversation</h3>
                  {[
                    ...thread.inbounds
                      .filter((i) => i.id !== selected.id)
                      .map((i) => ({ kind: "inbound" as const, ts: i.received_at, item: i })),
                    ...thread.replies.map((r) => ({ kind: "reply" as const, ts: r.created_at, item: r })),
                  ]
                    .sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime())
                    .map((entry, idx) =>
                      entry.kind === "inbound" ? (
                        <div key={`in-${entry.item.id}`} className="border rounded p-3 bg-muted/30">
                          <div className="text-xs text-muted-foreground mb-1">
                            <strong>{parseAddress(entry.item.from_address).name}</strong> ·{" "}
                            {new Date(entry.item.received_at).toLocaleString()}
                          </div>
                          <pre className="whitespace-pre-wrap text-sm font-sans">
                            {entry.item.text_body ?? entry.item.html_body?.replace(/<[^>]+>/g, "") ?? "(no body)"}
                          </pre>
                        </div>
                      ) : (
                        <div key={`out-${entry.item.id}-${idx}`} className="border-l-4 border-primary rounded p-3 bg-primary/5">
                          <div className="text-xs text-muted-foreground mb-1">
                            <strong>You ({entry.item.sent_by})</strong> ·{" "}
                            {new Date(entry.item.created_at).toLocaleString()} · to{" "}
                            {entry.item.to_addresses.join(", ")}
                          </div>
                          <pre className="whitespace-pre-wrap text-sm font-sans">
                            {entry.item.body_text ?? entry.item.body_html?.replace(/<[^>]+>/g, "") ?? "(no body)"}
                          </pre>
                        </div>
                      ),
                    )}
                </div>
              )}

              {/* Reply composer */}
              <div className="border-t pt-4 space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold">
                    Reply to {parseAddress(selected.from_address).name}
                  </h3>
                  <button
                    type="button"
                    onClick={insertQuotedOriginal}
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                  >
                    Quote original
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sending as <strong>hello@getprettypotty.com</strong>. Threaded as a reply.
                </p>
                <Textarea
                  ref={replyTextareaRef}
                  value={replyBody}
                  onChange={(e) => setReplyBody(e.target.value)}
                  placeholder="Type your reply… use Insert image to embed pictures inline."
                  rows={6}
                  className="resize-y"
                />
                <input
                  ref={replyFileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    addReplyFiles(e.target.files);
                    e.target.value = "";
                  }}
                />
                <input
                  ref={replyImageInputRef}
                  type="file"
                  multiple
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    insertReplyImagesAtCursor(e.target.files);
                    e.target.value = "";
                  }}
                />
                {replyFiles.length > 0 && (
                  <ul className="text-xs space-y-1">
                    {replyFiles.map((f, i) => (
                      <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                        <span className="truncate">📎 {f.name}</span>
                        <span className="text-muted-foreground">({formatBytes(f.size)})</span>
                        <button
                          type="button"
                          onClick={() => removeReplyFile(i)}
                          className="text-muted-foreground hover:text-foreground"
                          aria-label={`Remove ${f.name}`}
                        >
                          ✕
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center justify-between gap-2">
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => replyImageInputRef.current?.click()}
                      disabled={sendingReply}
                    >
                      Insert image
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => replyFileInputRef.current?.click()}
                      disabled={sendingReply}
                    >
                      Attach files
                    </Button>
                  </div>
                  <Button onClick={sendReply} disabled={sendingReply || !replyBody.trim()}>
                    {sendingReply ? "Sending…" : "Send reply"}
                  </Button>
                </div>
              </div>
            </article>
          )}
        </section>
      </main>

      {/* Compose new email dialog */}
      <Dialog open={composeOpen} onOpenChange={setComposeOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>New email</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              From <strong>hello@getprettypotty.com</strong>
            </p>
            <div>
              <Label htmlFor="compose-to">To</Label>
              <Input
                id="compose-to"
                value={composeTo}
                onChange={(e) => setComposeTo(e.target.value)}
                placeholder="recipient@example.com (comma-separated for multiple)"
              />
            </div>
            <div>
              <Label htmlFor="compose-subject">Subject</Label>
              <Input
                id="compose-subject"
                value={composeSubject}
                onChange={(e) => setComposeSubject(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="compose-body">Message</Label>
              <Textarea
                id="compose-body"
                ref={composeTextareaRef}
                value={composeBody}
                onChange={(e) => setComposeBody(e.target.value)}
                rows={10}
                className="resize-y"
              />
            </div>
            <input
              ref={composeFileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(e) => {
                addComposeFiles(e.target.files);
                e.target.value = "";
              }}
            />
            <input
              ref={composeImageInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                insertComposeImagesAtCursor(e.target.files);
                e.target.value = "";
              }}
            />
            <div>
              <div className="flex items-center justify-between">
                <Label>Attachments</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => composeImageInputRef.current?.click()}
                    disabled={composeSending}
                  >
                    Insert image
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => composeFileInputRef.current?.click()}
                    disabled={composeSending}
                  >
                    Add files
                  </Button>
                </div>
              </div>
              {composeFiles.length === 0 ? (
                <p className="text-xs text-muted-foreground mt-1">No files attached.</p>
              ) : (
                <ul className="text-xs space-y-1 mt-2">
                  {composeFiles.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center gap-2">
                      <span className="truncate">📎 {f.name}</span>
                      <span className="text-muted-foreground">({formatBytes(f.size)})</span>
                      <button
                        type="button"
                        onClick={() => removeComposeFile(i)}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label={`Remove ${f.name}`}
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setComposeOpen(false)} disabled={composeSending}>
              Cancel
            </Button>
            <Button onClick={sendCompose} disabled={composeSending}>
              {composeSending ? "Sending…" : "Send"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AdminInbox;
