import { Link } from "react-router-dom";
import { Phone, Mail, MapPin, Instagram } from "lucide-react";
import { NAV, SITE } from "@/lib/site";

const Footer = () => {
  return (
    <footer className="bg-ink text-background mt-24">
      <div className="container-tight py-16 grid gap-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="font-serif text-3xl">
            Pretty <span className="italic text-primary">Potty</span>
          </div>
          <p className="mt-4 text-background/70 max-w-sm leading-relaxed">
            Luxury restroom trailers for weddings, events, and job sites across Central Texas. Locally owned in {SITE.city}.
          </p>
          <div className="mt-6 space-y-2 text-sm text-background/80">
            <a href={SITE.phoneLink} className="flex items-center gap-2 hover:text-primary transition-colors">
              <Phone className="h-4 w-4" /> {SITE.phone}
            </a>
            <a href={`mailto:${SITE.email}`} className="flex items-center gap-2 hover:text-primary transition-colors">
              <Mail className="h-4 w-4" /> {SITE.email}
            </a>
            <p className="flex items-center gap-2"><MapPin className="h-4 w-4" /> Austin, Texas</p>
            <a
              href={SITE.instagramUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 hover:text-primary transition-colors"
            >
              <Instagram className="h-4 w-4" /> @{SITE.instagramHandle}
            </a>
          </div>
        </div>

        <div>
          <h4 className="font-serif text-lg mb-4">Explore</h4>
          <ul className="space-y-2 text-sm text-background/70">
            {NAV.map((n) => (
              <li key={n.to}><Link to={n.to} className="hover:text-primary transition-colors">{n.label}</Link></li>
            ))}
          </ul>
        </div>

        <div>
          <h4 className="font-serif text-lg mb-4">Service Area</h4>
          <p className="text-sm text-background/70 leading-relaxed">{SITE.serviceArea}</p>
        </div>
      </div>

      <div className="border-t border-background/10">
        <div className="container-tight py-6 flex flex-col sm:flex-row gap-3 items-center justify-between text-xs text-background/50">
          <p>© {new Date().getFullYear()} Pretty Potty. All rights reserved.</p>
          <p>{SITE.tagline}</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
