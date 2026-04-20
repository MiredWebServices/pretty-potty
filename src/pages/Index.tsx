import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowRight, Phone, Sparkles, Clock, Truck, MapPin, Heart, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import QuoteForm from "@/components/QuoteForm";
import Testimonials from "@/components/Testimonials";
import FAQ from "@/components/FAQ";
import { SITE } from "@/lib/site";

import heroImg from "@/assets/hero-interior.jpg";
import exteriorImg from "@/assets/trailer-exterior.jpg";
import vanityImg from "@/assets/interior-vanity.jpg";
import weddingImg from "@/assets/wedding-setup.jpg";
import eventImg from "@/assets/event-setup.jpg";
import constructionImg from "@/assets/construction-setup.jpg";

const BENEFITS = [
  { icon: Sparkles, title: "Luxury, clean interiors", desc: "Real flushing toilets, marble vanities, and warm lighting." },
  { icon: Heart, title: "No lines for guests", desc: "Multi-stall comfort that keeps your event flowing." },
  { icon: Clock, title: "Setup in 15–30 min", desc: "Quiet, fast, and out of the way before guests arrive." },
  { icon: Truck, title: "Reliable delivery", desc: "On-time, on-spec, every single event." },
  { icon: MapPin, title: "Locally owned in Austin", desc: "Real Texans serving Central Texas with care." },
];

const USE_CASES = [
  {
    title: "Weddings",
    desc: "An upscale restroom experience your guests will remember — for the right reasons.",
    img: weddingImg,
    href: "/wedding-restroom-trailer-austin",
  },
  {
    title: "Events",
    desc: "Corporate gatherings, private parties, and festivals deserve elevated amenities.",
    img: eventImg,
    href: "/events",
  },
  {
    title: "Construction",
    desc: "Long-term rentals that crews actually look forward to using.",
    img: constructionImg,
    href: "/construction",
  },
];

const FEATURES = [
  "Serves 100–150 guests",
  "Real flushing toilets",
  "Running water sinks",
  "Soft interior lighting",
  "Climate control",
  "Delivered & set up for you",
];

const Index = () => {
  return (
    <Layout
      title="Pretty Potty — Luxury Restroom Trailer Rental in Austin, TX"
      description="Austin's premier luxury restroom trailers for weddings, events, and job sites across Central Texas. Get a free quote today."
      canonical="https://getprettypotty.com/"
    >
      {/* HERO */}
      <section className="relative overflow-hidden bg-gradient-soft">
        <div className="absolute inset-0 bg-gradient-hero opacity-60 pointer-events-none" />
        <div className="container-tight relative pt-10 pb-20 md:pt-20 md:pb-28 grid gap-12 md:gap-10 md:grid-cols-2 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <p className="eyebrow mb-5">Austin, Texas · Luxury Restroom Trailers</p>
            <h1 className="font-serif text-5xl sm:text-6xl md:text-7xl leading-[1.02] text-ink text-balance">
              Luxury restroom trailers in <span className="italic text-primary">Austin, TX</span>
            </h1>
            <p className="mt-6 text-lg md:text-xl text-muted-foreground max-w-xl leading-relaxed">
              Perfect for weddings, events, and job sites across Central Texas. Spotless, beautiful, and effortlessly set up for you.
            </p>
            <div className="mt-9 flex flex-col sm:flex-row gap-3">
              <Button asChild variant="hero" size="lg">
                <Link to="/contact">
                  Get a Quote <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg">
                <a href={SITE.phoneLink}>
                  <Phone className="h-4 w-4" /> Call {SITE.phone}
                </a>
              </Button>
            </div>
            <div className="mt-10 flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex -space-x-1">
                <span className="h-2 w-2 rounded-full bg-primary" />
                <span className="h-2 w-2 rounded-full bg-secondary" />
                <span className="h-2 w-2 rounded-full bg-gold" />
              </div>
              Trusted by Central Texas weddings & events
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.2 }}
            className="relative"
          >
            <div className="relative aspect-[4/5] rounded-[2rem] overflow-hidden shadow-card">
              <img
                src={heroImg}
                alt="Luxury restroom trailer interior with marble vanity and warm lighting"
                className="w-full h-full object-cover"
                loading="eager"
                width={1920}
                height={1280}
              />
            </div>
            <div className="hidden md:block absolute -bottom-6 -left-6 w-44 aspect-square rounded-2xl overflow-hidden shadow-card border-4 border-background">
              <img src={exteriorImg} alt="Restroom trailer exterior at sunset" className="w-full h-full object-cover" loading="eager" />
            </div>
            <div className="hidden md:flex absolute -top-6 -right-6 px-5 py-4 rounded-2xl bg-card shadow-card border border-border/60 items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary flex items-center justify-center">
                <Sparkles className="h-5 w-5 text-ink" />
              </div>
              <div>
                <div className="font-serif text-lg leading-none text-ink">Spotless</div>
                <div className="text-xs text-muted-foreground mt-1">Every event, guaranteed</div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* TRUST + VISUAL */}
      <section className="py-24">
        <div className="container-tight grid md:grid-cols-2 gap-14 items-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="grid grid-cols-2 gap-4"
          >
            <div className="aspect-[3/4] rounded-2xl overflow-hidden shadow-soft">
              <img src={vanityImg} alt="Vanity interior" className="w-full h-full object-cover" loading="lazy" />
            </div>
            <div className="aspect-[3/4] rounded-2xl overflow-hidden shadow-soft mt-10">
              <img src={exteriorImg} alt="Trailer exterior" className="w-full h-full object-cover" loading="lazy" />
            </div>
          </motion.div>
          <div>
            <p className="eyebrow mb-3">The Pretty Potty difference</p>
            <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">
              Clean, modern, and designed to elevate your event
            </h2>
            <p className="mt-6 text-lg text-muted-foreground leading-relaxed">
              We treat every restroom like it's our own — with marble vanities, real running water, soft lighting, and the kind of finishing touches your guests notice. Because the details always do.
            </p>
            <Button asChild variant="ghostInk" size="lg" className="mt-8 -ml-3">
              <Link to="/gallery">View the gallery <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* WHY CHOOSE US */}
      <section className="py-24 bg-muted/60">
        <div className="container-tight">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="eyebrow mb-3">Why choose us</p>
            <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">
              The luxury your guests deserve
            </h2>
          </div>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
            {BENEFITS.map((b, i) => (
              <motion.div
                key={b.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{ duration: 0.5, delay: i * 0.08 }}
                className="rounded-2xl bg-card p-7 border border-border/60 hover:shadow-card hover:-translate-y-1 transition-all duration-500"
              >
                <div className="h-11 w-11 rounded-full bg-primary-soft flex items-center justify-center mb-5">
                  <b.icon className="h-5 w-5 text-ink" />
                </div>
                <h3 className="font-serif text-xl text-ink mb-2">{b.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{b.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* USE CASES */}
      <section className="py-24">
        <div className="container-tight">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-6 mb-12">
            <div>
              <p className="eyebrow mb-3">Where we shine</p>
              <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance max-w-xl">
                Built for the moments that matter
              </h2>
            </div>
            <p className="text-muted-foreground max-w-md">
              From hill country weddings to long-term construction sites, we deliver the same standard of care.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {USE_CASES.map((u, i) => (
              <motion.article
                key={u.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="group rounded-2xl overflow-hidden bg-card border border-border/60 shadow-soft hover:shadow-card transition-all duration-500"
              >
                <div className="aspect-[4/3] overflow-hidden">
                  <img
                    src={u.img}
                    alt={u.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700"
                    loading="lazy"
                  />
                </div>
                <div className="p-7">
                  <h3 className="font-serif text-2xl text-ink mb-2">{u.title}</h3>
                  <p className="text-muted-foreground mb-5">{u.desc}</p>
                  <Button asChild variant="ghostInk" size="sm" className="-ml-3">
                    <Link to={u.href}>Learn more <ArrowRight className="h-4 w-4" /></Link>
                  </Button>
                </div>
              </motion.article>
            ))}
          </div>
        </div>
      </section>

      {/* FEATURED TRAILER */}
      <section className="py-24 bg-secondary-soft/60">
        <div className="container-tight grid md:grid-cols-2 gap-14 items-center">
          <div className="aspect-[4/3] rounded-3xl overflow-hidden shadow-card order-last md:order-first">
            <img src={exteriorImg} alt="3-stall luxury restroom trailer" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div>
            <p className="eyebrow mb-3">Featured trailer</p>
            <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">
              The 3-Stall Luxury Restroom Trailer
            </h2>
            <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
              Our signature trailer comfortably serves 100–150 guests in elevated style. Bright, climate-controlled interiors with real plumbing — no compromises.
            </p>
            <ul className="mt-8 grid sm:grid-cols-2 gap-3">
              {FEATURES.map((f) => (
                <li key={f} className="flex items-center gap-3 text-ink">
                  <span className="h-6 w-6 rounded-full bg-primary flex items-center justify-center shrink-0">
                    <Check className="h-3.5 w-3.5 text-ink" />
                  </span>
                  <span className="text-sm">{f}</span>
                </li>
              ))}
            </ul>
            <Button asChild variant="hero" size="lg" className="mt-9">
              <Link to="/contact">Check availability <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="py-24">
        <div className="container-tight">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <p className="eyebrow mb-3">How it works</p>
            <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">Three simple steps</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {[
              { n: "01", t: "Request a quote", d: "Share a few details about your event and we'll send custom pricing within 24 hours." },
              { n: "02", t: "Choose your date", d: "We'll confirm availability and walk through delivery, setup, and any custom touches." },
              { n: "03", t: "We handle everything", d: "Our team delivers, sets up, and picks up — leaving you to enjoy the day." },
            ].map((s, i) => (
              <motion.div
                key={s.n}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: i * 0.1 }}
                className="relative rounded-2xl p-8 bg-card border border-border/60"
              >
                <div className="font-serif text-6xl text-primary/70 leading-none mb-4">{s.n}</div>
                <h3 className="font-serif text-2xl text-ink mb-2">{s.t}</h3>
                <p className="text-muted-foreground leading-relaxed">{s.d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <Testimonials />

      {/* FINAL CTA + FORM */}
      <section className="py-24 bg-gradient-soft">
        <div className="container-tight grid md:grid-cols-2 gap-12 items-start">
          <div className="md:sticky md:top-28">
            <p className="eyebrow mb-3">Get pricing</p>
            <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">
              Get pricing for <span className="italic text-primary">your event</span>
            </h2>
            <p className="mt-5 text-lg text-muted-foreground leading-relaxed">
              Tell us a bit about your day and we'll send a personalized quote within 24 hours. Most weddings book 4–8 months ahead.
            </p>
            <div className="mt-8 flex flex-col gap-3 text-ink">
              <a href={SITE.phoneLink} className="inline-flex items-center gap-3 hover:text-primary transition-colors">
                <Phone className="h-4 w-4" /> {SITE.phone}
              </a>
              <p className="text-sm text-muted-foreground">Serving {SITE.serviceArea}</p>
            </div>
          </div>
          <QuoteForm />
        </div>
      </section>

      <FAQ />
    </Layout>
  );
};

export default Index;
