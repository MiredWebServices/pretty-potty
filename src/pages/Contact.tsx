import Layout from "@/components/Layout";
import QuoteForm from "@/components/QuoteForm";
import { Phone, Mail, MapPin } from "lucide-react";
import { SITE } from "@/lib/site";

const Contact = () => {
  return (
    <Layout
      title="Contact — Get a Quote | Pretty Potty Austin"
      description="Request a luxury restroom trailer quote in Austin, TX. We respond within 24 hours."
      canonical="https://getprettypotty.com/contact"
    >
      <section className="bg-gradient-soft pt-16 pb-10 md:pt-24">
        <div className="container-tight text-center max-w-3xl mx-auto">
          <p className="eyebrow mb-4">Get a quote</p>
          <h1 className="font-serif text-5xl md:text-6xl text-ink text-balance">
            Let's plan your <span className="italic text-primary">event</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Tell us about your day and we'll send custom pricing within 24 hours.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container-tight grid lg:grid-cols-3 gap-10">
          <aside className="space-y-6">
            <div className="rounded-2xl bg-card p-7 border border-border/60 shadow-soft">
              <h3 className="font-serif text-xl text-ink mb-4">Contact</h3>
              <ul className="space-y-3 text-sm">
                <li>
                  <a href={SITE.phoneLink} className="flex items-center gap-3 text-ink hover:text-primary">
                    <Phone className="h-4 w-4" /> {SITE.phone}
                  </a>
                </li>
                <li>
                  <a href={`mailto:${SITE.email}`} className="flex items-center gap-3 text-ink hover:text-primary">
                    <Mail className="h-4 w-4" /> {SITE.email}
                  </a>
                </li>
                <li className="flex items-center gap-3 text-muted-foreground">
                  <MapPin className="h-4 w-4" /> Austin, Texas
                </li>
              </ul>
            </div>
            <div className="rounded-2xl overflow-hidden border border-border/60 shadow-soft aspect-square">
              <iframe
                title="Pretty Potty Austin service area"
                src="https://www.google.com/maps?q=Austin,Texas&output=embed"
                className="w-full h-full border-0"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <div className="rounded-2xl bg-blush/60 p-6 border border-border/60">
              <h4 className="font-serif text-lg text-ink mb-2">Service area</h4>
              <p className="text-sm text-muted-foreground leading-relaxed">{SITE.serviceArea}</p>
            </div>
          </aside>

          <div className="lg:col-span-2">
            <QuoteForm />
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Contact;
