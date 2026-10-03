"use client";
import { useSession } from "../lib/authClient";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";

// Paths that don't require authentication
const PUBLIC_PATHS = ["/sign-in", "/sign-up"];
// Paths that are public by prefix
const PUBLIC_PREFIXES = ["/share/"];

function isPublicPath(pathname: string): boolean {
  return (
    PUBLIC_PATHS.includes(pathname) ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  );
}

export function SessionGuard({ children }: { children: React.ReactNode }) {
  const { data: session, isPending } = useSession();
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (isPending) return;
    if (!session && !isPublicPath(pathname)) {
      router.replace("/sign-in");
    }
    // Redirect authenticated users away from auth pages to dashboard
    if (session && isPublicPath(pathname)) {
      router.replace("/dashboard");
    }
  }, [session, isPending, pathname, router]);

  // Show nothing while checking auth to avoid flash
  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center text-brand">
        <span className="inline-block h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      </div>
    );
  }

  return <>{children}</>;
}
