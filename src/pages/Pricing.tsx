import { Link } from "react-router-dom";
import { Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import FAQ from "@/components/FAQ";

const PACKAGES = [
  {
    name: "Half-Day",
    price: "From $1,000",
    desc: "Up to 6 hours · Perfect for ceremonies & short events",
    features: ["3-stall luxury trailer", "Delivery & setup", "Climate control", "Within 60 mi of Austin"],
  },
  {
    name: "Wedding Day",
    price: "From $1,400",
    desc: "Most popular · Full event day",
    features: ["3-stall luxury trailer", "Delivery, setup & pickup", "Stocked amenities", "Within 90 mi of Austin", "On-call event support"],
    featured: true,
  },
  {
    name: "Multi-Day / Construction",
    price: "Custom",
    desc: "Festivals, weekends, jobsite contracts",
    features: ["Weekly & monthly rates", "Scheduled servicing", "Volume discounts", "Statewide service available"],
  },
];

const Pricing = () => {
  return (
    <Layout
      title="Pricing — Luxury Restroom Trailer Rental Austin | Pretty Potty"
      description="Transparent pricing for luxury restroom trailer rentals in Austin, TX. Wedding, event, and construction packages available."
      canonical="https://getprettypotty.com/pricing"
    >
      <section className="bg-gradient-soft pt-16 pb-12 md:pt-24">
        <div className="container-tight text-center max-w-3xl mx-auto">
          <p className="eyebrow mb-4">Pricing</p>
          <h1 className="font-serif text-5xl md:text-6xl text-ink text-balance">
            Simple, all-in <span className="italic text-primary">pricing</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            Every quote includes delivery, setup, pickup, and our white-glove service. No surprise fees.
          </p>
        </div>
      </section>

      <section className="py-20">
        <div className="container-tight grid gap-6 md:grid-cols-3">
          {PACKAGES.map((p) => (
            <div
              key={p.name}
              className={
                "rounded-2xl p-8 border flex flex-col " +
                (p.featured
                  ? "bg-ink text-background border-ink shadow-card scale-[1.02]"
                  : "bg-card border-border/60 shadow-soft")
              }
            >
              {p.featured && (
                <span className="self-start mb-4 text-xs uppercase tracking-widest bg-primary text-ink px-3 py-1 rounded-full">
                  Most popular
                </span>
              )}
              <h3 className="font-serif text-2xl mb-1">{p.name}</h3>
              <p className={p.featured ? "text-background/70 text-sm mb-6" : "text-muted-foreground text-sm mb-6"}>
                {p.desc}
              </p>
              <div className="font-serif text-4xl mb-6">{p.price}</div>
              <ul className="space-y-3 mb-8 flex-1">
                {p.features.map((f) => (
                  <li key={f} className="flex items-center gap-3 text-sm">
                    <Check className={"h-4 w-4 " + (p.featured ? "text-primary" : "text-ink")} /> {f}
                  </li>
                ))}
              </ul>
              <Button asChild variant={p.featured ? "sun" : "hero"} size="lg">
                <Link to="/contact">Get exact pricing <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </div>
          ))}
        </div>
        <p className="text-center text-sm text-muted-foreground mt-10">
          Pricing varies by date, location, and event duration. Request a custom quote for exact pricing.
        </p>
      </section>

      <FAQ />
    </Layout>
  );
};

export default Pricing;
