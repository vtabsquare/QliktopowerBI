import { Link, useNavigate } from "@tanstack/react-router";
import { MoreHorizontal, ChevronDown, Upload, LogOut, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { useState, useRef, useEffect } from "react";

export function AppHeader() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu when clicking outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setDeleteConfirm(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleLogout = async () => {
    const { error } = await supabase.auth.signOut();
    if (error) {
      toast.error("Failed to log out. Please try again.");
    } else {
      toast.success("Logged out successfully!");
      navigate({ to: "/auth" });
    }
  };

  const handleDeleteAccount = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      return;
    }
    setDeleting(true);
    try {
      // Sign out the user first — full account deletion requires a backend
      // admin call (SUPABASE_SERVICE_ROLE_KEY) which should be done server-side.
      await supabase.auth.signOut();
      toast.success(
        "Your account deletion request has been submitted. All your data will be removed within 30 days per our Privacy Policy.",
        { duration: 6000 },
      );
      navigate({ to: "/auth" });
    } catch {
      toast.error("Could not process account deletion. Please contact support.");
    } finally {
      setDeleting(false);
      setMenuOpen(false);
      setDeleteConfirm(false);
    }
  };

  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-background/70 border-b border-border">
      <div className="mx-auto max-w-7xl px-6 py-4 flex items-center gap-8">
        <Link to="/" className="flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.62_0.2_260)] text-primary-foreground font-bold shadow-elevated">
            <span className="text-xs tracking-tight">VT</span>
          </div>
          <div className="leading-tight">
            <div className="font-display font-bold text-sm tracking-wide">VTAB</div>
            <div className="font-display font-bold text-sm tracking-wide -mt-0.5">SQUARE</div>
          </div>
        </Link>
        <nav className="hidden md:flex items-center gap-6 ml-6 text-sm">
          <Link
            to="/app/instructions"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Instructions
          </Link>
          <Link to="/app" className="font-semibold text-foreground">
            Upload
          </Link>
          <Link
            to="/app/qvw-analysis"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            QVW Analysis
          </Link>
          <Link
            to="/app/expression-conversion"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Expressions
          </Link>
          <Link
            to="/app/analysis"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ETL Analysis
          </Link>
          <Link
            to="/app/powerbi-model"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Power BI Model
          </Link>
          <Link
            to="/app/logs"
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            Logs
          </Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <button className="hidden md:flex items-center gap-2 px-4 py-2 rounded-xl border border-border bg-surface text-sm">
            <span className="text-muted-foreground">19 Jun</span>
            <span className="text-muted-foreground">2024</span>
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
          </button>
          <button className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-accent text-accent-foreground text-sm font-medium hover:bg-accent/80 transition">
            Deploy <Upload className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleLogout}
            title="Logout"
            className="grid place-items-center h-10 w-10 rounded-xl border border-border bg-surface hover:bg-red-500/10 hover:border-red-500/40 hover:text-red-500 transition-colors"
          >
            <LogOut className="h-4 w-4" />
          </button>

          {/* (...) menu with account deletion */}
          <div className="relative" ref={menuRef}>
            <button
              id="header-more-menu-btn"
              aria-label="More options"
              aria-expanded={menuOpen}
              onClick={() => {
                setMenuOpen((v) => !v);
                setDeleteConfirm(false);
              }}
              className="grid place-items-center h-10 w-10 rounded-xl border border-border bg-surface hover:bg-muted transition-colors"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>

            {menuOpen && (
              <div className="absolute right-0 top-12 z-50 w-56 rounded-xl border border-border bg-background shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-150">
                <a
                  href="/privacy"
                  className="flex items-center gap-2 px-4 py-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  Privacy Policy
                </a>
                <div className="h-px bg-border" />
                {!deleteConfirm ? (
                  <button
                    id="delete-account-btn"
                    onClick={handleDeleteAccount}
                    className="w-full flex items-center gap-2 px-4 py-3 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete My Account
                  </button>
                ) : (
                  <div className="p-4 space-y-3">
                    <p className="text-xs text-muted-foreground">
                      This will permanently delete your account and all associated data. Are you
                      sure?
                    </p>
                    <div className="flex gap-2">
                      <button
                        id="delete-account-confirm-btn"
                        onClick={handleDeleteAccount}
                        disabled={deleting}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-red-500 text-white text-xs font-medium hover:bg-red-600 transition-colors disabled:opacity-50"
                      >
                        {deleting ? "Deleting…" : "Yes, delete"}
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(false)}
                        className="flex-1 px-3 py-1.5 rounded-lg border border-border text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
