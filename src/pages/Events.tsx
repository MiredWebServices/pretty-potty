import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import PageHero from "@/components/PageHero";
import QuoteForm from "@/components/QuoteForm";
import eventImg from "@/assets/event-setup.jpg";

const Events = () => {
  const types = [
    { t: "Corporate gatherings", d: "Outdoor company events, brand activations, and team retreats with elevated amenities." },
    { t: "Private parties", d: "Birthdays, anniversaries, milestone celebrations — handled seamlessly." },
    { t: "Festivals & galas", d: "Multi-day events that need clean, dependable, beautiful restrooms." },
  ];

  return (
    <Layout
      title="Event Restroom Trailer Rental in Austin | Pretty Potty"
      description="Premium restroom trailers for corporate events, private parties, and festivals across Austin and Central Texas."
      canonical="https://getprettypotty.com/events"
    >
      <PageHero
        eyebrow="Events"
        title={<>Elevated restrooms for <span className="italic text-primary">every event</span></>}
        subtitle="Corporate, private, public — when the experience matters, we deliver the upgrade your guests will remember."
        image={eventImg}
      />

      <section className="py-24">
        <div className="container-tight">
          <div className="grid gap-6 md:grid-cols-3">
            {types.map((x) => (
              <div key={x.t} className="rounded-2xl bg-card p-8 border border-border/60 shadow-soft">
                <h3 className="font-serif text-2xl text-ink mb-3">{x.t}</h3>
                <p className="text-muted-foreground leading-relaxed">{x.d}</p>
              </div>
            ))}
          </div>
          <div className="text-center mt-14">
            <Button asChild variant="hero" size="lg">
              <Link to="/contact">Plan your event <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="py-24 bg-secondary-soft/50">
        <div className="container-tight max-w-3xl">
          <QuoteForm />
        </div>
      </section>
    </Layout>
  );
};

export default Events;
