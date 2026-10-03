"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "../../lib/authClient";
import { Button, ErrorNote, Logo, Spinner } from "../ui";

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

  const field = "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-[15px] text-ink outline-none transition-colors placeholder:text-ink-3 focus:border-brand/60 focus:ring-2 focus:ring-brand/15";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <Link href="/" className="mb-8"><Logo /></Link>
      <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-7 shadow-[var(--shadow-card)]">
        <h1 className="text-center text-[24px] font-semibold text-ink">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="mt-1 text-center text-sm text-ink-2">
          {isSignUp ? "Ask questions about your data in plain English." : "Sign in to continue to your analyses."}
        </p>
        <form onSubmit={submit} className="mt-6 space-y-3.5">
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
