import { motion } from "framer-motion";
import { Star } from "lucide-react";

const REVIEWS = [
  {
    quote:
      "Our wedding guests couldn't stop raving about the restrooms. They felt like a luxury hotel suite — completely transformed the experience.",
    name: "Hannah & Marcus",
    role: "Wedding · Dripping Springs",
  },
  {
    quote:
      "Pretty Potty made our outdoor gala feel effortlessly upscale. Spotless, beautiful, and the team was incredibly professional.",
    name: "Elena R.",
    role: "Corporate event · Austin",
  },
  {
    quote:
      "Setup was fast, the trailer was pristine, and our guests had zero complaints. Worth every penny for our hill country wedding.",
    name: "Sophie & James",
    role: "Wedding · Wimberley",
  },
];

const Testimonials = () => {
  return (
    <section className="py-24 bg-blush/40">
      <div className="container-tight">
        <div className="text-center max-w-2xl mx-auto mb-14">
          <p className="eyebrow mb-3">Loved by Central Texas</p>
          <h2 className="font-serif text-4xl md:text-5xl text-ink text-balance">
            What our clients are saying
          </h2>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          {REVIEWS.map((r, i) => (
            <motion.figure
              key={r.name}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.6, delay: i * 0.1 }}
              className="rounded-2xl bg-card p-8 shadow-soft border border-border/60 flex flex-col"
            >
              <div className="flex gap-0.5 mb-5 text-primary">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Star key={j} className="h-4 w-4 fill-current" />
                ))}
              </div>
              <blockquote className="font-serif text-lg leading-relaxed text-ink flex-1">
                "{r.quote}"
              </blockquote>
              <figcaption className="mt-6 pt-6 border-t border-border/60">
                <div className="font-medium text-ink">{r.name}</div>
                <div className="text-sm text-muted-foreground">{r.role}</div>
              </figcaption>
            </motion.figure>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Testimonials;
