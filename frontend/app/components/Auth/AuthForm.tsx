"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "../../lib/authClient";
import { Button, ErrorNote, Logo, Spinner } from "../ui";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
      <path fill="#4285F4" d="M22.5 12.27c0-.79-.07-1.54-.2-2.27H12v4.51h5.9a5.04 5.04 0 0 1-2.19 3.31v2.75h3.55c2.08-1.92 3.28-4.74 3.28-8.3z" />
      <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.55-2.75c-.98.66-2.24 1.06-3.73 1.06-2.87 0-5.3-1.94-6.17-4.55H2.17v2.84A11 11 0 0 0 12 23z" />
      <path fill="#FBBC05" d="M5.83 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.17a11 11 0 0 0 0 9.88l3.66-2.84z" />
      <path fill="#EA4335" d="M12 5.35c1.62 0 3.06.56 4.21 1.65l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.17 7.06l3.66 2.84C6.7 7.29 9.13 5.35 12 5.35z" />
    </svg>
  );
}

function GitHubIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden>
      <path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.52-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.15.08 1.76 1.19 1.76 1.19 1.03 1.76 2.7 1.25 3.36.96.1-.75.4-1.25.73-1.54-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.47.11-3.06 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.78 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.77.11 3.06.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5z" />
    </svg>
  );
}

export default function AuthForm({ mode }: { mode: "sign-in" | "sign-up" }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const isSignUp = mode === "sign-up";

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = isSignUp
        ? await signUp.email({ name, email, password, callbackURL: "/dashboard" })
        : await signIn.email({ email, password, callbackURL: "/dashboard" });
      if (result.error) setError(result.error.message ?? "That didn't work. Please try again.");
      else router.push(isSignUp ? "/" : "/dashboard");
    } catch (err) {
      setError((err as Error).message || "That didn't work. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const social = async (provider: "google" | "github") => {
    setError(null);
    setLoading(true);
    try {
      // Absolute URL: in local dev the API lives on another origin, so a relative path would land on the backend.
      const result = await signIn.social({ provider, callbackURL: `${window.location.origin}/dashboard` });
      if (result?.error) {
        setError(result.error.message ?? `${provider === "google" ? "Google" : "GitHub"} sign-in isn't available right now.`);
        setLoading(false);
      }
    } catch (err) {
      setError((err as Error).message || "That didn't work. Please try again.");
      setLoading(false);
    }
  };

  const field = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand/60 focus:ring-2 focus:ring-brand/15";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8"><Logo /></Link>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-card)]">
        <h1 className="text-center text-[24px] font-semibold text-ink">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-center text-sm text-ink-2">
          {isSignUp ? "Ask questions about your data in plain English." : "Sign in to continue to your analyses."}
        </p>
        <div className="mt-6 space-y-2.5">
          <Button type="button" variant="secondary" size="lg" className="w-full gap-2" disabled={loading} onClick={() => social("google")}>
            <GoogleIcon /> Continue with Google
          </Button>
          <Button type="button" variant="secondary" size="lg" className="w-full gap-2" disabled={loading} onClick={() => social("github")}>
            <GitHubIcon /> Continue with GitHub
          </Button>
        </div>
        <div className="my-5 flex items-center gap-3 text-xs text-ink-3">
          <span className="h-px flex-1 bg-line" /> or <span className="h-px flex-1 bg-line" />
        </div>
        <form onSubmit={submit} className="space-y-3.5">
          {isSignUp && (
            <label className="block">
              <span className="mb-1 block text-[13px] font-semibold text-ink-2">Name</span>
              <input className={field} required value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" placeholder="Jane Smith" />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-ink-2">Email</span>
            <input className={field} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@company.com" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[13px] font-semibold text-ink-2">Password</span>
            <input className={field} type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignUp ? "new-password" : "current-password"} placeholder={isSignUp ? "At least 8 characters" : "••••••••"} />
          </label>
          {error && <ErrorNote>{error}</ErrorNote>}
          <Button type="submit" variant="primary" size="lg" className="w-full" disabled={loading}>
            {loading ? <><Spinner className="h-4 w-4" /> {isSignUp ? "Creating account…" : "Signing in…"}</> : isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>
      </div>
      <p className="mt-6 text-sm text-ink-2">
        {isSignUp ? "Already have an account? " : "New to Clairvoyance? "}
        <Link href={isSignUp ? "/sign-in" : "/sign-up"} className="font-semibold text-brand hover:underline">
          {isSignUp ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </div>
  );
}
