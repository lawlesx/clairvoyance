"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { signOut, useSession } from "../lib/authClient";
import { Icon, Logo } from "./ui";

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();
  const { data } = useSession();

  const link = (href: string, label: string) => (
    <Link href={href}
      className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${pathname === href ? "bg-sunken text-ink" : "text-ink-3 hover:text-ink"}`}>
      {label}
    </Link>
  );

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-canvas/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <div className="flex items-center gap-5">
          <Link href="/dashboard" aria-label="Clairvoyance home"><Logo /></Link>
          <nav className="hidden items-center gap-1 sm:flex">
            {link("/dashboard", "My analyses")}
            {link("/", "New analysis")}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {data?.user.email && <span className="hidden max-w-[220px] truncate text-sm text-ink-3 md:inline">{data.user.email}</span>}
          <button onClick={() => signOut().then(() => router.push("/sign-in"))}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-sm font-semibold text-ink-3 hover:bg-sunken hover:text-ink">
            <Icon name="logout" /> <span className="hidden sm:inline">Sign out</span>
          </button>
        </div>
      </div>
    </header>
  );
}
