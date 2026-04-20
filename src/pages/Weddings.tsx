import { Link } from "react-router-dom";
import { ArrowRight, Heart, Sparkles, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import Layout from "@/components/Layout";
import PageHero from "@/components/PageHero";
import QuoteForm from "@/components/QuoteForm";
import Testimonials from "@/components/Testimonials";
import weddingImg from "@/assets/wedding-setup.jpg";
import vanityImg from "@/assets/interior-vanity.jpg";

const Weddings = () => {
  return (
    <Layout
      title="Wedding Restroom Trailer Rental in Austin, TX | Pretty Potty"
      description="Luxury wedding restroom trailers in Austin and Central Texas. Marble vanities, no lines, and a guest experience your wedding deserves."
      canonical="https://getprettypotty.com/wedding-restroom-trailer-austin"
    >
      <PageHero
        eyebrow="Weddings"
        title={<>An experience worthy of your <span className="italic text-primary">wedding day</span></>}
        subtitle="From intimate hill country ceremonies to grand vineyard receptions — your guests deserve restrooms that match the rest of the day."
        image={weddingImg}
      />

      <section className="py-24">
        <div className="container-tight grid md:grid-cols-2 gap-14 items-center">
          <div className="aspect-[3/4] rounded-3xl overflow-hidden shadow-card">
            <img src={vanityImg} alt="Wedding restroom trailer vanity interior" className="w-full h-full object-cover" loading="lazy" />
          </div>
          <div>
            <p className="eyebrow mb-3">Built for the big day</p>
            <h2 className="font-serif text-4xl text-ink mb-5">Beautiful enough for your photos</h2>
            <p className="text-muted-foreground leading-relaxed text-lg">
              Our trailers are warmly lit, fully air-conditioned, and finished with details that look stunning on camera and feel even better in person. No more pretending the porta-potty isn't there.
            </p>
            <ul className="mt-8 space-y-4">
              {[
                { i: Sparkles, t: "Hotel-bathroom feel", d: "Marble vanities, brass fixtures, and warm lighting." },
                { i: Heart, t: "No awkward lines", d: "Multi-stall layout keeps your reception flowing." },
                { i: Camera, t: "Photo-ready exterior", d: "Clean white finish that blends into your decor." },
              ].map((b) => (
                <li key={b.t} className="flex gap-4">
                  <div className="h-10 w-10 shrink-0 rounded-full bg-primary-soft flex items-center justify-center">
                    <b.i className="h-5 w-5 text-ink" />
                  </div>
                  <div>
                    <div className="font-medium text-ink">{b.t}</div>
                    <div className="text-sm text-muted-foreground">{b.d}</div>
                  </div>
                </li>
              ))}
            </ul>
            <Button asChild variant="hero" size="lg" className="mt-10">
              <Link to="/contact">Reserve your date <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>

      <Testimonials />

      <section className="py-24 bg-blush/40">
        <div className="container-tight max-w-3xl">
          <QuoteForm />
        </div>
      </section>
    </Layout>
  );
};

export default Weddings;
