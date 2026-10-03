import type { Metadata } from "next";
import { Literata, Nunito_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { SessionGuard } from "./components/SessionGuard";

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  style: ["normal", "italic"],
  display: "swap",
});

const nunitoSans = Nunito_Sans({
  variable: "--font-nunito-sans",
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Clairvoyance — Ask your data anything",
  description: "Upload a spreadsheet or connect a database and ask questions in plain English. Clear answers and the right chart, no SQL needed.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${literata.variable} ${nunitoSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-canvas text-ink">
        <SessionGuard>{children}</SessionGuard>
      </body>
    </html>
  );
}
