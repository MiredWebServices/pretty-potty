import { Instagram } from "lucide-react";
import { SITE } from "@/lib/site";

const SocialRail = () => {
  return (
    <div className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 flex-col items-center">
      <a
        href={SITE.instagramUrl}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Follow Pretty Potty on Instagram (@${SITE.instagramHandle})`}
        className="group flex items-center gap-2 bg-ink text-background pl-2 pr-3 py-3 rounded-r-xl shadow-card hover:bg-primary hover:text-ink transition-colors duration-300"
      >
        <Instagram className="h-5 w-5" />
        <span className="text-xs font-medium tracking-wide whitespace-nowrap max-w-0 overflow-hidden group-hover:max-w-[10rem] transition-[max-width] duration-500 ease-in-out">
          @{SITE.instagramHandle}
        </span>
      </a>
    </div>
  );
};

export default SocialRail;
