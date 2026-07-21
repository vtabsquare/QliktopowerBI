import { createFileRoute } from "@tanstack/react-router";
import { Shield } from "lucide-react";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — VTAB Square" },
      { name: "description", content: "VTAB Square privacy policy: what data we collect, how we use it, and your rights." },
    ],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  const lastUpdated = "14 July 2026";

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-4 flex items-center gap-3">
          <a href="/" className="flex items-center gap-2 text-sm font-semibold text-foreground hover:text-primary transition-colors">
            ← Back
          </a>
          <span className="text-muted-foreground">/</span>
          <span className="text-sm text-muted-foreground">Privacy Policy</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-16">
        {/* Title */}
        <div className="flex items-center gap-3 mb-3">
          <div className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
            <Shield className="h-5 w-5" />
          </div>
          <span className="text-sm font-mono text-muted-foreground">VTAB SQUARE</span>
        </div>
        <h1 className="text-4xl font-black tracking-tight text-foreground mb-3">Privacy Policy</h1>
        <p className="text-muted-foreground mb-12">Last updated: {lastUpdated}</p>

        <div className="prose prose-neutral dark:prose-invert max-w-none space-y-10 text-sm leading-relaxed text-muted-foreground">

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">1. Who We Are</h2>
            <p>
              VTAB Square is an enterprise-grade Qlik to Power BI migration tool operated by VTAB. 
              This tool is intended exclusively for authorised business users and is not a public consumer product.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">2. What Data We Collect</h2>
            <p>We collect the absolute minimum information needed to operate the service:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong className="text-foreground">Email address</strong> — used for account authentication and sending verification codes.</li>
              <li><strong className="text-foreground">Hashed password</strong> — stored using industry-standard bcrypt hashing via Supabase Auth. We never store your plain-text password.</li>
              <li><strong className="text-foreground">Uploaded Qlik project files</strong> — processed temporarily for migration and not stored permanently.</li>
              <li><strong className="text-foreground">Session tokens</strong> — used to keep you securely logged in.</li>
            </ul>
            <p className="mt-3">We do <strong className="text-foreground">not</strong> collect your name, phone number, address, payment information, or any government-issued ID.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">3. How We Use Your Data</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>To authenticate you and maintain your session.</li>
              <li>To send you one-time verification codes for account security.</li>
              <li>To process your Qlik files and generate Power BI migration output.</li>
            </ul>
            <p className="mt-3">Your data is <strong className="text-foreground">never</strong> sold, rented, or shared with third parties for marketing or advertising purposes.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">4. Cookies</h2>
            <p>
              We use <strong className="text-foreground">essential cookies only</strong> — specifically, a secure session token to keep you logged in. 
              No tracking, analytics, or advertising cookies are set. You can accept or decline non-essential cookies via the banner shown on your first visit.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">5. Data Storage & Security</h2>
            <ul className="list-disc list-inside space-y-1">
              <li>Your data is stored in a Supabase-managed PostgreSQL database with AES-256 encryption at rest.</li>
              <li>All data is transmitted over TLS 1.2+ encrypted connections.</li>
              <li>Row-Level Security (RLS) policies ensure you can only access your own data.</li>
              <li>Sessions automatically expire after 30 minutes of inactivity.</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li><strong className="text-foreground">Access</strong> — request a copy of all personal data we hold about you.</li>
              <li><strong className="text-foreground">Correction</strong> — request correction of inaccurate data.</li>
              <li><strong className="text-foreground">Deletion</strong> — request permanent deletion of your account and all associated data.</li>
              <li><strong className="text-foreground">Objection</strong> — object to specific uses of your data.</li>
              <li><strong className="text-foreground">Portability</strong> — export your data in a structured format.</li>
            </ul>
            <p className="mt-3">To exercise any of these rights, contact us at <a href="mailto:privacy@vtabsquare.com" className="underline hover:text-primary transition-colors">privacy@vtabsquare.com</a>. We will respond within 30 days as required by applicable data protection law.</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">7. Data Retention</h2>
            <p>
              Your account data is retained for as long as your account is active. Uploaded migration files are processed in-memory and are not retained permanently. 
              If you delete your account, all associated personal data is permanently removed within 30 days.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">8. Third-Party Services</h2>
            <ul className="list-disc list-inside space-y-1">
              <li><strong className="text-foreground">Supabase</strong> — authentication and database hosting (EU-based data processing).</li>
              <li><strong className="text-foreground">Brevo (Sendinblue)</strong> — transactional email delivery for verification codes.</li>
            </ul>
            <p className="mt-3">Both services are covered by appropriate Data Processing Agreements (DPAs).</p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">9. Changes to This Policy</h2>
            <p>
              We may update this privacy policy from time to time. Registered users will be notified by email of any material changes.
              The latest version will always be available at this URL.
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-foreground mb-3">10. Contact</h2>
            <p>
              For any privacy-related questions or requests, please contact:<br />
              <a href="mailto:privacy@vtabsquare.com" className="underline hover:text-primary transition-colors">privacy@vtabsquare.com</a>
            </p>
          </section>

        </div>
      </main>
    </div>
  );
}
