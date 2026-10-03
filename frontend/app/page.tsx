"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import AppHeader from "./components/AppHeader";
import { ConnectDatabase, FileDrop } from "./components/DataUpload/DataUpload";
import { ErrorNote, Icon } from "./components/ui";
import { uploadCSV } from "./lib/api";

const EXAMPLES = [
  "How did revenue trend month by month this year?",
  "Which regions grew fastest last quarter?",
  "Is there a relationship between discount and order size?",
  "What share of customers come back for a second order?",
];

export default function Home() {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFiles = async (files: File[]) => {
    setUploading(true);
    setError(null);
    try {
      const { sessionId } = await uploadCSV(files);
      router.push(`/session/${sessionId}`);
    } catch (e) {
      setError((e as Error).message);
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen">
      <AppHeader />
      <main className="mx-auto max-w-5xl px-4 pb-20 pt-12 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-2xl text-center">
          <h1 className="text-[34px] font-semibold leading-[1.15] tracking-tight text-ink sm:text-[44px]">
            Ask your data anything.
          </h1>
          <p className="mt-4 text-[17px] leading-relaxed text-ink-2">
            Bring a spreadsheet or connect a database, then ask questions in plain English.
            You get a straight answer and the right chart — no SQL, no knowing how the data is organised.
          </p>
        </div>

        {error && <div className="mx-auto mt-8 max-w-xl"><ErrorNote>{error}</ErrorNote></div>}

        <div className="mt-10 grid gap-5 md:grid-cols-2">
          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-soft text-accent"><Icon name="file" className="h-5 w-5" /></span>
              <div>
                <h2 className="font-sans text-[16px] font-semibold text-ink">Upload a spreadsheet</h2>
                <p className="text-[13px] text-ink-3">CSV exports from Excel, Google Sheets, or any tool</p>
              </div>
            </div>
            <FileDrop onFiles={handleFiles} busy={uploading} />
          </section>

          <section className="rounded-2xl border border-line bg-surface p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-soft text-brand"><Icon name="database" className="h-5 w-5" /></span>
              <div>
                <h2 className="font-sans text-[16px] font-semibold text-ink">Connect a database</h2>
                <p className="text-[13px] text-ink-3">PostgreSQL or MySQL — any size, even hundreds of tables</p>
              </div>
            </div>
            <ConnectDatabase onConnected={(id) => router.push(`/session/${id}`)} />
          </section>
        </div>

        <div className="mt-12">
          <p className="mb-3 text-center text-[13px] font-semibold uppercase tracking-wide text-ink-3">Then ask things like</p>
          <div className="flex flex-wrap justify-center gap-2">
            {EXAMPLES.map((q) => (
              <span key={q} className="rounded-full border border-line bg-surface-2 px-3.5 py-1.5 text-[13px] text-ink-2">{q}</span>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
