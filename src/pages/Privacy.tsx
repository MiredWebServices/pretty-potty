import Layout from "@/components/Layout";
import { SITE } from "@/lib/site";

// Last meaningful update to this policy. Bump when you change anything
// substantive (new processors, new data categories, new sharing rules).
const LAST_UPDATED = "April 28, 2026";

const Privacy = () => {
  return (
    <Layout
      title="Privacy Policy | Pretty Potty Austin"
      description="How Pretty Potty collects, uses, and protects your information, including SMS opt-in data."
      canonical="https://getprettypotty.com/privacy"
    >
      <section className="bg-gradient-soft pt-16 pb-10 md:pt-24">
        <div className="container-tight text-center max-w-3xl mx-auto">
          <p className="eyebrow mb-4">Legal</p>
          <h1 className="font-serif text-5xl md:text-6xl text-ink text-balance">
            Privacy <span className="italic text-primary">Policy</span>
          </h1>
          <p className="mt-6 text-sm text-muted-foreground">
            Last updated: {LAST_UPDATED}
          </p>
        </div>
      </section>

      <section className="py-16">
        <div className="container-tight max-w-3xl mx-auto prose prose-neutral prose-headings:font-serif prose-headings:text-ink prose-a:text-primary">
          <p>
            Pretty Potty ("we," "us," or "our") operates the website
            <a href="https://getprettypotty.com"> getprettypotty.com</a> and
            provides luxury restroom trailer rentals across Central Texas.
            This policy explains what information we collect, how we use it,
            and your choices.
          </p>

          <h2>Information we collect</h2>
          <ul>
            <li>
              <strong>Contact details</strong> you provide when requesting a
              quote, booking a rental, or contacting us — name, email, phone
              number, event details (date, location, guest count, type), and
              billing address.
            </li>
            <li>
              <strong>Communication content</strong> — the text of emails,
              SMS messages, and form submissions you send us, plus our
              replies.
            </li>
            <li>
              <strong>Payment information</strong> — handled by our payment
              processor (Stripe). We never store full card numbers; we only
              receive a confirmation that payment succeeded.
            </li>
            <li>
              <strong>Website usage</strong> — basic analytics (pages
              visited, referrer, approximate location, device type) collected
              by standard server logs and analytics tools.
            </li>
          </ul>

          <h2>How we use your information</h2>
          <ul>
            <li>To respond to quote requests and answer questions.</li>
            <li>
              To deliver, set up, and service the rental you booked,
              including coordinating delivery times and on-site logistics.
            </li>
            <li>To send invoices, receipts, and payment reminders.</li>
            <li>
              To send service-related text messages (delivery ETAs, arrival
              confirmations, follow-ups about your specific booking) when
              you have asked us to or have texted us first.
            </li>
            <li>
              To improve our website and the quality of our customer service
              (e.g., review past conversations to train our team and
              automated reply system to be more helpful).
            </li>
            <li>To comply with our legal and accounting obligations.</li>
          </ul>

          <h2>SMS / text messaging</h2>
          <p>
            We use SMS only for service-related communication tied to a quote
            request, booking, or active rental. You may opt in by:
          </p>
          <ul>
            <li>Texting us first at {SITE.phone};</li>
            <li>
              Submitting our website quote form with a phone number and
              checking the box authorizing us to text you about your
              request; or
            </li>
            <li>Verbally agreeing during a phone call.</li>
          </ul>
          <p>
            Standard message and data rates may apply. Message frequency
            varies and is tied to your specific inquiry or booking. You can
            opt out at any time by replying <strong>STOP</strong> to any
            message; reply <strong>HELP</strong> for assistance, or contact
            us at <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
          </p>
          <p>
            <strong>
              All the above categories exclude text messaging originator
              opt-in data and consent; this information will not be shared
              with any third parties.
            </strong>{" "}
            Phone numbers and SMS opt-in consent collected for the purpose
            of receiving messages from Pretty Potty are never sold, rented,
            or shared with third parties or affiliates for their own
            marketing or promotional purposes.
          </p>
          <p>
            Some of our SMS replies may be drafted with the assistance of
            automated tools (including AI-powered language models) so we can
            respond promptly. A human reviews any reply that quotes a price,
            confirms availability, or addresses an active booking.
          </p>

          <h2>How we share information</h2>
          <p>
            We share personal information only with the service providers
            we need to operate the business, and only for the purposes
            described above:
          </p>
          <ul>
            <li>
              <strong>Stripe</strong> — payment processing. Subject to
              Stripe's own privacy policy.
            </li>
            <li>
              <strong>Quo (OpenPhone)</strong> — phone calls and SMS
              delivery. Subject to OpenPhone's privacy policy.
            </li>
            <li>
              <strong>Resend</strong> — transactional email delivery
              (invoices, replies). Subject to Resend's privacy policy.
            </li>
            <li>
              <strong>Supabase</strong> — secure cloud hosting of our
              database and application. Subject to Supabase's privacy
              policy.
            </li>
            <li>
              <strong>Anthropic</strong> — AI-assisted reply drafting for
              SMS and email. Message content may be sent to Anthropic for
              the sole purpose of generating a draft response on our behalf.
            </li>
            <li>
              <strong>Legal requirements</strong> — when we are required by
              law, subpoena, or to protect our rights or the safety of
              others.
            </li>
          </ul>
          <p>
            We do <strong>not</strong> sell your personal information, and
            we do not share it with third parties for their own marketing
            purposes.
          </p>

          <h2>How long we keep information</h2>
          <p>
            We keep your information for as long as needed to provide the
            service, comply with legal obligations (typically 7 years for
            financial records), resolve disputes, and enforce our
            agreements. You can request deletion of information that is not
            subject to a legal retention requirement.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>
              <strong>Access or correct</strong> the information we hold
              about you by emailing{" "}
              <a href={`mailto:${SITE.email}`}>{SITE.email}</a>.
            </li>
            <li>
              <strong>Delete</strong> your information (subject to our legal
              retention obligations) by emailing the address above.
            </li>
            <li>
              <strong>Opt out of SMS</strong> at any time by replying{" "}
              <strong>STOP</strong>.
            </li>
            <li>
              <strong>Opt out of marketing email</strong> by clicking
              "unsubscribe" in the footer of any marketing email (we
              currently send transactional email only).
            </li>
          </ul>

          <h2>Security</h2>
          <p>
            We use industry-standard security practices, including encrypted
            transport (HTTPS), encrypted storage at rest with our hosting
            provider, role-based access control, and limiting employee
            access to information on a need-to-know basis. No system is
            perfectly secure, and we cannot guarantee absolute security.
          </p>

          <h2>Children</h2>
          <p>
            Our services are not directed to children under 13, and we do
            not knowingly collect personal information from them. If you
            believe a child has provided us information, please contact us
            and we will delete it.
          </p>

          <h2>Changes to this policy</h2>
          <p>
            We may update this policy from time to time. The "Last updated"
            date at the top of this page reflects the most recent revision.
            Material changes will be posted on this page and, where
            appropriate, communicated by email to active customers.
          </p>

          <h2>Contact us</h2>
          <p>
            Questions about this policy? Reach out:
          </p>
          <ul>
            <li>
              Email: <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
            </li>
            <li>
              Phone: <a href={SITE.phoneLink}>{SITE.phone}</a>
            </li>
            <li>Pretty Potty, Austin, Texas</li>
          </ul>
        </div>
      </section>
    </Layout>
  );
};

export default Privacy;
