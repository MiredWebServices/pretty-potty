import { ReactNode } from "react";
import { motion } from "framer-motion";

interface PageHeroProps {
  eyebrow?: string;
  title: ReactNode;
  subtitle?: string;
  image: string;
}

const PageHero = ({ eyebrow, title, subtitle, image }: PageHeroProps) => {
  return (
    <section className="relative overflow-hidden bg-gradient-soft pt-12 pb-20 md:pt-20 md:pb-28">
      <div className="container-tight grid gap-12 md:grid-cols-2 items-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7 }}
        >
          {eyebrow && <p className="eyebrow mb-4">{eyebrow}</p>}
          <h1 className="font-serif text-5xl md:text-6xl leading-[1.05] text-ink text-balance">{title}</h1>
          {subtitle && (
            <p className="mt-6 text-lg text-muted-foreground max-w-lg leading-relaxed">{subtitle}</p>
          )}
        </motion.div>
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.9, delay: 0.1 }}
          className="relative aspect-[4/3] rounded-3xl overflow-hidden shadow-card"
        >
          <img src={image} alt="" className="w-full h-full object-cover" loading="eager" />
        </motion.div>
      </div>
    </section>
  );
};

export default PageHero;
