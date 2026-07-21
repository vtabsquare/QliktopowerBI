import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState, useCallback } from "react";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import { ArrowRight, Lock, Mail, UserPlus, KeyRound, Eye, EyeOff, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/auth")({
  component: AuthPage,
});

type AuthState =
  "SIGN_IN" | "SIGN_UP" | "VERIFY_OTP" | "FORGOT_PASSWORD" | "RECOVERY_OTP" | "NEW_PASSWORD";

// ─── Password strength helpers ───────────────────────────────────────────────
const COMMON_PASSWORDS = ["password", "12345678", "qwerty123", "abc123456", "letmein1"];

interface StrengthResult {
  score: number; // 0-4
  label: string;
  color: string;
  issues: string[];
}

function analyzePassword(pw: string): StrengthResult {
  const issues: string[] = [];
  if (pw.length < 12) issues.push("At least 12 characters");
  if (!/[A-Z]/.test(pw)) issues.push("One uppercase letter");
  if (!/[a-z]/.test(pw)) issues.push("One lowercase letter");
  if (!/[0-9]/.test(pw)) issues.push("One number");
  if (!/[^A-Za-z0-9]/.test(pw)) issues.push("One special character (!@#$...)");
  if (COMMON_PASSWORDS.some((c) => pw.toLowerCase().includes(c)))
    issues.push("Avoid common passwords");

  const score = Math.max(0, 4 - Math.floor(issues.length * 0.75));
  const labels = ["Very Weak", "Weak", "Fair", "Strong", "Very Strong"];
  const colors = ["bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-blue-500", "bg-green-500"];
  return { score, label: pw.length === 0 ? "" : labels[score], color: colors[score], issues };
}

function isPasswordValid(pw: string): boolean {
  const { issues } = analyzePassword(pw);
  return issues.length === 0;
}

// ─── Sanitize error messages so raw Supabase internals are never shown ────────
function sanitizeError(err: unknown): string {
  if (!(err instanceof Error)) return "An unexpected error occurred. Please try again.";
  const msg = err.message.toLowerCase();
  if (msg.includes("invalid login credentials") || msg.includes("invalid email or password"))
    return "Incorrect email or password. Please try again.";
  if (msg.includes("email not confirmed"))
    return "Please verify your email address before signing in.";
  if (
    msg.includes("user already registered") ||
    msg.includes("already been registered") ||
    msg.includes("account with this email already exists")
  )
    return "An account with this email already exists. Please sign in instead.";
  if (msg.includes("token") || msg.includes("otp") || msg.includes("expired"))
    return "The verification code is invalid or has expired. Please request a new one.";
  if (msg.includes("rate limit") || msg.includes("too many"))
    return "Too many attempts. Please wait a moment and try again.";
  if (msg.includes("network") || msg.includes("fetch"))
    return "A network error occurred. Please check your connection and try again.";
  return "Something went wrong. Please try again or contact support.";
}

// ─── Reusable password input with show/hide toggle ────────────────────────────
function PasswordInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <KeyRound className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
      <input
        id={id}
        type={visible ? "text" : "password"}
        required
        autoComplete={id.includes("new") ? "new-password" : "current-password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pl-10 pr-10"
        placeholder={placeholder ?? "••••••••"}
        maxLength={128}
        minLength={id === "signin-password" ? 1 : 12}
      />
      <button
        type="button"
        aria-label={visible ? "Hide password" : "Show password"}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-3 top-2.5 text-muted-foreground hover:text-foreground transition-colors"
      >
        {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

// ─── Password strength meter ──────────────────────────────────────────────────
function PasswordStrengthMeter({ password }: { password: string }) {
  if (!password) return null;
  const { score, label, color, issues } = analyzePassword(password);
  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i <= score ? color : "bg-muted"
            }`}
          />
        ))}
      </div>
      {label && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <ShieldCheck className="h-3 w-3" />
          Strength: <span className="font-semibold">{label}</span>
        </p>
      )}
      {issues.length > 0 && (
        <ul className="text-xs text-muted-foreground space-y-0.5 list-disc list-inside">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Main Auth Page ───────────────────────────────────────────────────────────
function AuthPage() {
  const navigate = useNavigate();
  const [authState, setAuthState] = useState<AuthState>("SIGN_IN");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stateToken, setStateToken] = useState("");
  const [loading, setLoading] = useState(false);

  const postAuthJson = useCallback(async (path: string, body: Record<string, string>) => {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Authentication request failed.");
    return data;
  }, []);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid(password)) {
      toast.error("Please fix the password issues shown below before continuing.");
      return;
    }
    setLoading(true);
    try {
      const res = await postAuthJson("/api/auth/signup/send-otp", { email });
      setStateToken(res.stateToken || "");
      toast.success("Verification code sent to your email.");
      setAuthState("VERIFY_OTP");
    } catch (error) {
      toast.error(sanitizeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      toast.error(sanitizeError(error));
    } else {
      toast.success("Logged in successfully");
      navigate({ to: "/app/instructions" });
    }
  };

  const handleVerifySignupOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await postAuthJson("/api/auth/signup/verify", { email, password, token: otp, stateToken });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Email verified successfully!");
      navigate({ to: "/app/instructions" });
    } catch (error) {
      toast.error(sanitizeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await postAuthJson("/api/auth/recovery/send-otp", { email });
      setStateToken(res.stateToken || "");
      toast.success("Password reset code sent to your email.");
      setAuthState("RECOVERY_OTP");
    } catch (error) {
      toast.error(sanitizeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRecoveryOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await postAuthJson("/api/auth/recovery/verify", { email, token: otp, stateToken });
      toast.success("Code verified. Please create a new password.");
      setAuthState("NEW_PASSWORD");
    } catch (error) {
      toast.error(sanitizeError(error));
    } finally {
      setLoading(false);
    }
  };

  const handleNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid(password)) {
      toast.error("Please fix the password issues shown below before continuing.");
      return;
    }
    setLoading(true);
    try {
      await postAuthJson("/api/auth/recovery/reset", {
        email,
        token: otp,
        stateToken,
        newPassword: password,
      });
      toast.success("Password reset successfully! Please sign in.");
      await supabase.auth.signOut();
      setAuthState("SIGN_IN");
      setPassword("");
      setOtp("");
    } catch (error) {
      toast.error(sanitizeError(error));
    } finally {
      setLoading(false);
    }
  };

  const inputCls =
    "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 pl-10";
  const btnCls =
    "inline-flex w-full items-center justify-center whitespace-nowrap rounded-md text-sm font-medium ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 bg-primary text-primary-foreground hover:bg-primary/90 h-10 px-4 py-2 mt-2";

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-background">
      {/* Left side branding */}
      <div className="w-full md:w-1/2 bg-zinc-950 p-12 flex flex-col justify-between relative overflow-hidden border-r border-white/10">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/10 via-transparent to-transparent pointer-events-none" />
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-500/20 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[60%] h-[60%] rounded-full bg-purple-500/10 blur-[100px] pointer-events-none" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Lock size={20} />
            </div>
            <span className="font-display font-black text-xl tracking-tight text-white">
              VTAB Square
            </span>
          </div>
        </div>

        <div className="relative z-10 mt-20 md:mt-0">
          <h1 className="font-display font-black text-4xl md:text-5xl lg:text-6xl text-white tracking-tight leading-[1.1] mb-6">
            Enterprise <br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-purple-400">
              Migration Hub
            </span>
          </h1>
          <p className="text-zinc-400 max-w-md text-lg leading-relaxed">
            Secure access to the Qlik to Power BI automated conversion engine. Authenticate to
            continue to your workspace.
          </p>
        </div>

        <div className="relative z-10 text-zinc-500 text-sm font-mono mt-12 md:mt-0">
          VTAB-AUTH-GATEWAY v2.1
        </div>
      </div>

      {/* Right side forms */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-8 md:p-12 relative bg-zinc-50 dark:bg-background">
        <div className="w-full max-w-md space-y-8">
          {/* Supabase not configured warning */}
          {!supabase && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500 text-center surface-card p-8 border border-amber-500/20 bg-amber-500/5">
              <div className="grid h-12 w-12 place-items-center rounded-xl bg-amber-500/20 text-amber-500 mx-auto mb-4">
                <Lock size={24} />
              </div>
              <h2 className="text-xl font-bold tracking-tight text-foreground mb-2">
                Auth Not Configured
              </h2>
              <p className="text-muted-foreground text-sm">
                Please add <code className="text-xs bg-muted px-1 rounded">VITE_SUPABASE_URL</code>{" "}
                and <code className="text-xs bg-muted px-1 rounded">VITE_SUPABASE_ANON_KEY</code> to
                your <code className="text-xs bg-muted px-1 rounded">.env</code> file and restart
                the development server.
              </p>
            </div>
          )}

          {/* ── SIGN IN ── */}
          {supabase && authState === "SIGN_IN" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
                  Welcome back
                </h2>
                <p className="text-muted-foreground">
                  Enter your credentials to access your account
                </p>
              </div>
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="signin-email" className="text-sm font-medium">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                      id="signin-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                      placeholder="name@company.com"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label htmlFor="signin-password" className="text-sm font-medium">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => setAuthState("FORGOT_PASSWORD")}
                      className="text-sm font-medium text-primary hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <PasswordInput id="signin-password" value={password} onChange={setPassword} />
                </div>
                <button type="submit" disabled={loading} className={btnCls}>
                  {loading ? "Signing in…" : "Sign In"}
                  {!loading && <ArrowRight className="ml-2 h-4 w-4" />}
                </button>
              </form>
              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Don't have an account? </span>
                <button
                  type="button"
                  onClick={() => {
                    setPassword("");
                    setAuthState("SIGN_UP");
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Create one
                </button>
              </div>
              <div className="mt-4 text-center text-xs text-muted-foreground">
                By signing in you agree to our{" "}
                <a href="/privacy" className="underline hover:text-primary transition-colors">
                  Privacy Policy
                </a>
              </div>
            </div>
          )}

          {/* ── SIGN UP ── */}
          {supabase && authState === "SIGN_UP" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
                  Create an account
                </h2>
                <p className="text-muted-foreground">Enter your details to get started</p>
              </div>
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="signup-email" className="text-sm font-medium">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                      id="signup-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                      placeholder="name@company.com"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label htmlFor="signup-password" className="text-sm font-medium">
                    Password
                  </label>
                  <PasswordInput
                    id="signup-password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Create a strong password"
                  />
                  <PasswordStrengthMeter password={password} />
                </div>
                <button type="submit" disabled={loading} className={btnCls}>
                  {loading ? "Creating account…" : "Sign Up"}
                  {!loading && <UserPlus className="ml-2 h-4 w-4" />}
                </button>
              </form>
              <div className="mt-6 text-center text-sm">
                <span className="text-muted-foreground">Already have an account? </span>
                <button
                  type="button"
                  onClick={() => {
                    setPassword("");
                    setAuthState("SIGN_IN");
                  }}
                  className="font-medium text-primary hover:underline"
                >
                  Sign in
                </button>
              </div>
              <div className="mt-4 text-center text-xs text-muted-foreground">
                By creating an account you agree to our{" "}
                <a href="/privacy" className="underline hover:text-primary transition-colors">
                  Privacy Policy
                </a>
              </div>
            </div>
          )}

          {/* ── VERIFY OTP / RECOVERY OTP ── */}
          {supabase && (authState === "VERIFY_OTP" || authState === "RECOVERY_OTP") && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
                  Check your email
                </h2>
                <p className="text-muted-foreground">
                  We sent a {authState === "RECOVERY_OTP" ? "8-digit" : "6-digit"} verification code
                  to <strong>{email}</strong>
                </p>
              </div>
              <form
                onSubmit={authState === "VERIFY_OTP" ? handleVerifySignupOtp : handleRecoveryOtp}
                className="space-y-6"
              >
                <div className="space-y-2">
                  <label htmlFor="otp-input" className="text-sm font-medium">
                    Verification Code
                  </label>
                  <input
                    id="otp-input"
                    type="text"
                    inputMode="numeric"
                    required
                    autoComplete="one-time-code"
                    maxLength={authState === "RECOVERY_OTP" ? 8 : 6}
                    value={otp}
                    onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                    className="flex h-12 text-center text-2xl tracking-[0.2em] sm:tracking-[0.5em] font-mono w-full rounded-md border border-input bg-background px-3 py-2 ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    placeholder={authState === "RECOVERY_OTP" ? "--------" : "------"}
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || otp.length !== (authState === "RECOVERY_OTP" ? 8 : 6)}
                  className={btnCls}
                >
                  {loading ? "Verifying…" : "Verify Code"}
                </button>
              </form>
              <div className="mt-6 text-center text-sm">
                <button
                  type="button"
                  onClick={() => setAuthState("SIGN_IN")}
                  className="font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  Back to sign in
                </button>
              </div>
            </div>
          )}

          {/* ── FORGOT PASSWORD ── */}
          {supabase && authState === "FORGOT_PASSWORD" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
                  Reset password
                </h2>
                <p className="text-muted-foreground">
                  Enter your email and we'll send you a verification code.
                </p>
              </div>
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="reset-email" className="text-sm font-medium">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <input
                      id="reset-email"
                      type="email"
                      required
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className={inputCls}
                      placeholder="name@company.com"
                    />
                  </div>
                </div>
                <button type="submit" disabled={loading} className={btnCls}>
                  {loading ? "Sending code…" : "Send Reset Code"}
                </button>
              </form>
              <div className="mt-6 text-center text-sm">
                <button
                  type="button"
                  onClick={() => setAuthState("SIGN_IN")}
                  className="font-medium text-muted-foreground hover:text-primary transition-colors"
                >
                  Back to sign in
                </button>
              </div>
            </div>
          )}

          {/* ── NEW PASSWORD ── */}
          {supabase && authState === "NEW_PASSWORD" && (
            <div className="animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="mb-8">
                <h2 className="text-2xl font-bold tracking-tight text-foreground mb-2">
                  Create new password
                </h2>
                <p className="text-muted-foreground">
                  Your email has been verified. Please create a new password.
                </p>
              </div>
              <form onSubmit={handleNewPassword} className="space-y-4">
                <div className="space-y-2">
                  <label htmlFor="new-password" className="text-sm font-medium">
                    New Password
                  </label>
                  <PasswordInput
                    id="new-password"
                    value={password}
                    onChange={setPassword}
                    placeholder="Create a strong password"
                  />
                  <PasswordStrengthMeter password={password} />
                </div>
                <button type="submit" disabled={loading} className={btnCls}>
                  {loading ? "Updating…" : "Update Password"}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
