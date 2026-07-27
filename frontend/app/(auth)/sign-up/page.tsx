"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { signUp } from "../../lib/authClient";

const CREAM = "#faf6f0";
const CARD_BG = "#FFFFFF";
const BORDER = "#e8e0d4";
const FIELD_BG = "#f5f1ea";
const GREEN = "#4a7c59";
const GREEN_DARK = "#2a6038";
const TEXT_DARK = "#2e3230";
const TEXT_MID = "#4a4e4a";
const TEXT_MUTED = "#74796e";

function Logo() {
  return (
    <div className="flex flex-col items-center gap-3 mb-8">
      <div
        className="w-11 h-11 rounded-full flex items-center justify-center"
        style={{ backgroundColor: GREEN }}
      >
        <svg className="w-5 h-5" style={{ color: "#FDFAF6" }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>
      <span className="font-semibold text-base" style={{ color: TEXT_DARK }}>Clairvoyance</span>
    </div>
  );
}

export default function SignUpPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signUp.email({ name, email, password, callbackURL: "/dashboard" });
      if (result.error) {
        setError(result.error.message ?? "Sign up failed");
      } else {
        router.push("/dashboard");
      }
    } catch (err: any) {
      setError(err.message ?? "Sign up failed");
    } finally {
      setLoading(false);
    }
  };

  const fieldClass = "w-full rounded-full px-5 py-3 text-sm border outline-none transition-all";
  const fieldStyle = { backgroundColor: FIELD_BG, borderColor: BORDER, color: TEXT_DARK };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-10" style={{ backgroundColor: CREAM }}>
      <Logo />

      <div
        className="w-full max-w-sm rounded-3xl p-8 border shadow-sm"
        style={{ backgroundColor: CARD_BG, borderColor: BORDER }}
      >
        <div className="text-center mb-7">
          <h1 className="text-2xl font-bold" style={{ color: TEXT_DARK }}>
            Create an account
          </h1>
          <p className="text-sm mt-1.5" style={{ color: TEXT_MID }}>Start exploring your data</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: TEXT_DARK }}>Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Your name"
              className={fieldClass}
              style={fieldStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = GREEN)}
              onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: TEXT_DARK }}>Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={fieldClass}
              style={fieldStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = GREEN)}
              onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1.5" style={{ color: TEXT_DARK }}>Password</label>
            <input
              type="password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className={fieldClass}
              style={fieldStyle}
              onFocus={(e) => (e.currentTarget.style.borderColor = GREEN)}
              onBlur={(e) => (e.currentTarget.style.borderColor = BORDER)}
            />
          </div>

          {error && (
            <p className="text-sm rounded-xl px-4 py-3 border" style={{ color: "#C0392B", backgroundColor: "#FEF2F0", borderColor: "#F5C6C0" }}>{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-full px-4 py-3 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed mt-1"
            style={{ backgroundColor: GREEN, color: "#FDFAF6" }}
            onMouseEnter={(e) => { if (!loading) e.currentTarget.style.backgroundColor = GREEN_DARK; }}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = GREEN)}
          >
            {loading ? "Creating account…" : "Create account"}
          </button>
        </form>
      </div>

      <p className="mt-6 text-sm" style={{ color: TEXT_MID }}>
        Already have an account?{" "}
        <Link href="/sign-in" className="font-semibold transition-colors" style={{ color: GREEN }}
          onMouseEnter={(e) => (e.currentTarget.style.color = GREEN_DARK)}
          onMouseLeave={(e) => (e.currentTarget.style.color = GREEN)}
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
