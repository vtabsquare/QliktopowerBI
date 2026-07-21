import { useState, useEffect } from "react";
import { Shield, X, Cookie } from "lucide-react";

const CONSENT_KEY = "vtab_cookie_consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CONSENT_KEY);
    if (!stored) {
      // Slight delay so it doesn't flash on load
      const t = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(t);
    }
  }, []);

  const accept = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: true, timestamp: new Date().toISOString() }));
    setVisible(false);
  };

  const decline = () => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ accepted: false, timestamp: new Date().toISOString() }));
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div
      role="dialog"
      aria-labelledby="cookie-banner-title"
      aria-describedby="cookie-banner-desc"
      className="fixed bottom-4 left-4 right-4 md:left-auto md:right-6 md:bottom-6 md:max-w-sm z-50 animate-in slide-in-from-bottom-4 fade-in duration-500"
    >
      <div className="rounded-2xl border border-border bg-background/95 backdrop-blur-xl shadow-2xl p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
              <Cookie className="h-4 w-4" />
            </div>
            <h3 id="cookie-banner-title" className="font-semibold text-sm text-foreground">Cookie Notice</h3>
          </div>
          <button
            onClick={decline}
            aria-label="Dismiss cookie notice"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p id="cookie-banner-desc" className="text-xs text-muted-foreground leading-relaxed mb-4">
          We use essential cookies to keep you securely logged in and remember your preferences. 
          No tracking or advertising cookies are used.{" "}
          <a href="/privacy" className="underline hover:text-primary transition-colors">Learn more</a>
        </p>

        <div className="flex gap-2">
          <button
            id="cookie-accept-btn"
            onClick={accept}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            <Shield className="h-3 w-3" />
            Accept Essential
          </button>
          <button
            id="cookie-decline-btn"
            onClick={decline}
            className="px-3 py-2 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Decline
          </button>
        </div>
      </div>
    </div>
  );
}
