import { Link } from "react-router-dom";
import { ArrowRight, ShieldCheck, Calendar, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import PageHero from "@/components/PageHero";
import QuoteForm from "@/components/QuoteForm";
import constructionImg from "@/assets/construction-setup.jpg";

const Construction = () => {
  const points = [
    { i: Calendar, t: "Flexible long-term rentals", d: "Weekly or monthly contracts that scale with your project timeline." },
    { i: ShieldCheck, t: "Reliable & well-maintained", d: "Regular service so your crews always walk into clean amenities." },
    { i: Wrench, t: "Built for the jobsite", d: "Durable, climate-controlled, and easy to position on any site." },
  ];

  return (
    <Layout
      title="Construction Restroom Trailer Rental Austin | Pretty Potty"
      description="Long-term luxury restroom trailer rentals for construction projects in Austin and Central Texas. Reliable service, premium amenities."
      canonical="https://getprettypotty.com/construction"
    >
      <PageHero
        eyebrow="Construction"
        title={<>Restrooms your <span className="italic text-primary">crew will love</span></>}
        subtitle="Long-term luxury rentals for construction projects across Central Texas. Because morale starts with the basics."
        image={constructionImg}
      />

      <section className="py-24">
        <div className="container-tight grid gap-6 md:grid-cols-3">
          {points.map((p) => (
            <div key={p.t} className="rounded-2xl bg-card p-8 border border-border/60 shadow-soft">
              <div className="h-11 w-11 rounded-full bg-primary-soft flex items-center justify-center mb-5">
                <p.i className="h-5 w-5 text-ink" />
              </div>
              <h3 className="font-serif text-xl text-ink mb-2">{p.t}</h3>
              <p className="text-muted-foreground leading-relaxed">{p.d}</p>
            </div>
          ))}
        </div>
        <div className="text-center mt-12">
          <Button asChild variant="hero" size="lg">
            <Link to="/contact">Get a project quote <ArrowRight className="h-4 w-4" /></Link>
          </Button>
        </div>
      </section>

      <section className="py-24 bg-muted/60">
        <div className="container-tight max-w-3xl">
          <QuoteForm />
        </div>
      </section>
    </Layout>
  );
};

export default Construction;
