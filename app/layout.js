import Link from "next/link";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Tech Stack Scout",
  description: "Live engineering intelligence and fit scores for FlowForge's target accounts.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="topbar">
          <Link href="/" className="brand">
            <span className="brand-mark" aria-hidden>◆</span> Tech Stack Scout
          </Link>
          <span className="topbar-sub">for FlowForge account executives · AI by Gemini Flash</span>
        </header>
        <main className="container">{children}</main>
      </body>
    </html>
  );
}
