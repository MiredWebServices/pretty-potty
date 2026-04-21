import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";

const schema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100),
  phone: z.string().trim().min(7, "Valid phone required").max(30),
  email: z.string().trim().email("Valid email required").max(255),
  eventDate: z.string().max(40).optional(),
  location: z.string().trim().max(120).optional(),
  guests: z.string().max(20).optional(),
  message: z.string().trim().max(1000).optional(),
});

interface QuoteFormProps {
  variant?: "card" | "embed";
}

const QuoteForm = ({ variant = "card" }: QuoteFormProps) => {
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.currentTarget));
    const parsed = schema.safeParse(data);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Please check the form");
      return;
    }
    setSubmitting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke(
        "send-quote-request",
        { body: parsed.data },
      );
      if (error || !result?.success) {
        throw new Error(error?.message || result?.error || "Submission failed");
      }
      setDone(true);
      toast.success("Quote request sent! We'll be in touch within 24 hours.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast.error(`Couldn't send: ${msg}. Please call (512) 270-5164.`);
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className={variant === "card" ? "rounded-2xl bg-card p-10 shadow-card text-center" : "text-center py-10"}>
        <div className="font-serif text-3xl text-ink mb-3">Thank you ✨</div>
        <p className="text-muted-foreground max-w-md mx-auto">
          Your request is in. Our team will reach out within 24 hours with custom pricing for your event.
        </p>
      </div>
    );
  }

  const wrapper =
    variant === "card"
      ? "rounded-2xl bg-card p-6 sm:p-10 shadow-card border border-border/60"
      : "";

  return (
    <form onSubmit={handleSubmit} className={wrapper}>
      {variant === "card" && (
        <div className="mb-8">
          <p className="eyebrow mb-2">Get a quote</p>
          <h3 className="font-serif text-3xl text-ink">Tell us about your event</h3>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="name">Full name</Label>
          <Input id="name" name="name" placeholder="Jane Doe" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" name="phone" type="tel" placeholder="(512) 270-5164" required />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" type="email" placeholder="you@email.com" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="eventDate">Event date</Label>
          <Input id="eventDate" name="eventDate" type="date" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="guests">Guest count</Label>
          <Input id="guests" name="guests" placeholder="100" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="location">Event location</Label>
          <Input id="location" name="location" placeholder="Dripping Springs, TX" />
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor="message">Tell us more</Label>
          <Textarea id="message" name="message" rows={4} placeholder="Anything else we should know?" />
        </div>
      </div>
      <Button type="submit" variant="hero" size="lg" className="mt-6 w-full" disabled={submitting}>
        {submitting ? "Sending…" : "Request my quote"}
      </Button>
      <p className="mt-3 text-xs text-muted-foreground text-center">
        We respond within 24 hours, Monday–Saturday.
      </p>
    </form>
  );
};

export default QuoteForm;
