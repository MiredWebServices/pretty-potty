import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { Menu, X, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NAV, SITE } from "@/lib/site";
import { cn } from "@/lib/utils";

const Header = () => {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { pathname } = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  return (
    <header
      className={cn(
        "fixed top-0 z-50 w-full transition-all duration-500",
        scrolled ? "bg-background/85 backdrop-blur-md shadow-soft border-b border-border/60" : "bg-transparent"
      )}
    >
      <div className="container-tight flex h-16 md:h-20 items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2 group">
          <span className="font-serif text-2xl md:text-[1.75rem] tracking-tight text-ink">
            Pretty <span className="italic text-primary">Potty</span>
          </span>
        </Link>

        <nav className="hidden lg:flex items-center gap-7">
          {NAV.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className={cn(
                "text-sm font-medium transition-colors hover:text-ink",
                pathname === n.to ? "text-ink" : "text-muted-foreground"
              )}
            >
              {n.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2 md:gap-3">
          <a
            href={SITE.phoneLink}
            className="hidden sm:inline-flex items-center gap-2 text-sm font-medium text-ink hover:text-primary transition-colors"
          >
            <Phone className="h-4 w-4" />
            {SITE.phone}
          </a>
          <Button asChild variant="hero" size="sm" className="hidden sm:inline-flex">
            <Link to="/contact">Get a Quote</Link>
          </Button>
          <button
            aria-label="Toggle menu"
            className="lg:hidden p-2 -mr-2 text-ink"
            onClick={() => setOpen((o) => !o)}
          >
            {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
          </button>
        </div>
      </div>

      {open && (
        <div className="lg:hidden border-t border-border bg-background/95 backdrop-blur-md animate-fade-in">
          <div className="container-tight py-4 flex flex-col gap-1">
            {NAV.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className={cn(
                  "py-3 text-base font-medium border-b border-border/60 last:border-0",
                  pathname === n.to ? "text-primary" : "text-ink"
                )}
              >
                {n.label}
              </Link>
            ))}
            <div className="flex flex-col gap-2 pt-4">
              <a href={SITE.phoneLink} className="inline-flex items-center justify-center gap-2 text-sm font-medium text-ink py-2">
                <Phone className="h-4 w-4" /> {SITE.phone}
              </a>
              <Button asChild variant="hero" size="lg">
                <Link to="/contact">Get a Quote</Link>
              </Button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
};

export default Header;
