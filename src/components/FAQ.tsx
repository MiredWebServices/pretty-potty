import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const FAQS = [
  {
    q: "How much does a luxury restroom trailer rental cost?",
    a: "Pricing varies based on your event date, location, and duration. Half-day events start at $1,000 and full wedding-day rentals start at $1,400 in the Austin area. Request a quote and we'll send custom pricing within 24 hours.",
  },
  {
    q: "How long does setup take?",
    a: "Our team handles full delivery, setup, and pickup. Setup typically takes 15–30 minutes, and we always arrive well before your event begins so everything is ready and pristine.",
  },
  {
    q: "What do you need at my venue?",
    a: "We require a relatively level area to park the trailer and access to a standard 110V outlet within 100 feet. If power isn't available, we can bring a quiet generator. Water hookup is preferred but not required for shorter events.",
  },
  {
    q: "How many guests does the trailer serve?",
    a: "Our 3-stall luxury trailer comfortably serves 100–150 guests for a typical event. For larger weddings or festivals, ask about pairing multiple trailers.",
  },
  {
    q: "What areas do you serve?",
    a: "We're based in Austin and serve all of Central Texas within a 2-hour radius — including Round Rock, Dripping Springs, Wimberley, Fredericksburg, San Marcos, Georgetown, and surrounding areas.",
  },
  {
    q: "How far in advance should I book?",
    a: "For wedding season (March–November), we recommend booking 4–8 months in advance. For weekday or off-season events, a few weeks of notice is usually plenty.",
  },
];

const FAQ = () => {
  return (
    <section className="py-24">
      <div className="container-tight max-w-3xl">
        <div className="text-center mb-12">
          <p className="eyebrow mb-3">Frequently asked</p>
          <h2 className="font-serif text-4xl md:text-5xl text-ink">Good questions, clear answers</h2>
        </div>
        <Accordion type="single" collapsible className="w-full">
          {FAQS.map((f, i) => (
            <AccordionItem key={i} value={`item-${i}`} className="border-b border-border">
              <AccordionTrigger className="text-left font-serif text-lg text-ink hover:no-underline py-5">
                {f.q}
              </AccordionTrigger>
              <AccordionContent className="text-muted-foreground leading-relaxed text-base pb-5">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>
      </div>
    </section>
  );
};

export default FAQ;
