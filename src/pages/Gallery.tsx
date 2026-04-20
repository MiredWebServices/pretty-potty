import Layout from "@/components/Layout";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";

import g1 from "@/assets/gallery-1.jpg";
import g2 from "@/assets/gallery-2.jpg";
import g3 from "@/assets/gallery-3.jpg";
import hero from "@/assets/hero-interior.jpg";
import exterior from "@/assets/trailer-exterior.jpg";
import vanity from "@/assets/interior-vanity.jpg";
import wedding from "@/assets/wedding-setup.jpg";
import event from "@/assets/event-setup.jpg";

const IMAGES = [
  { src: hero, alt: "Marble vanity interior" },
  { src: exterior, alt: "Trailer exterior at sunset" },
  { src: vanity, alt: "Brass fixtures and mirror" },
  { src: wedding, alt: "Wedding reception setup" },
  { src: g1, alt: "Lounge area inside trailer" },
  { src: g2, alt: "Trailer at night" },
  { src: g3, alt: "Stall interior" },
  { src: event, alt: "Corporate event setup" },
];

const Gallery = () => {
  return (
    <Layout
      title="Gallery — Luxury Restroom Trailers Austin | Pretty Potty"
      description="See our luxury restroom trailers up close — interior details, event setups, and real Central Texas events."
      canonical="https://getprettypotty.com/gallery"
    >
      <section className="bg-gradient-soft pt-16 pb-10 md:pt-24">
        <div className="container-tight text-center max-w-3xl mx-auto">
          <p className="eyebrow mb-4">Gallery</p>
          <h1 className="font-serif text-5xl md:text-6xl text-ink text-balance">
            See the <span className="italic text-primary">details</span>
          </h1>
          <p className="mt-6 text-lg text-muted-foreground">
            From marble vanities to twilight setups — a closer look at the Pretty Potty experience.
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container-tight">
          <div className="columns-1 sm:columns-2 lg:columns-3 gap-5 [column-fill:_balance]">
            {IMAGES.map((img, i) => (
              <div
                key={i}
                className="mb-5 break-inside-avoid rounded-2xl overflow-hidden shadow-soft hover:shadow-card transition-shadow duration-500"
              >
                <img src={img.src} alt={img.alt} loading="lazy" className="w-full h-auto block" />
              </div>
            ))}
          </div>
          <div className="text-center mt-12">
            <Button asChild variant="hero" size="lg">
              <Link to="/contact">Get a quote <ArrowRight className="h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </section>
    </Layout>
  );
};

export default Gallery;
