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
  description: "Know how a company builds software before your first sales call, with every finding linked to its source.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="topbar">
          <div className="topbar-inner">
            <Link href="/" className="brand">
              <span className="brand-mark" aria-hidden>
                <svg viewBox="0 0 24 24" width="16" height="16"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.8 8 12 11.7 5.2 8 12 4.3ZM5 9.7l6 3.3v6.7l-6-3.3V9.7Zm8 10V13l6-3.3v6.7l-6 3.3Z" fill="currentColor" /></svg>
              </span>
              Tech Stack Scout
            </Link>
            <nav className="nav">
              <Link href="/">New research</Link>
              <Link href="/watchlist">Watchlist</Link>
            </nav>
          </div>
        </header>
        <main className="container">{children}</main>
        <footer className="footer">
          Public sources only: GitHub, official job boards, and engineering articles found with Google Search. Scores are computed in code; Gemini Flash only writes the text.
        </footer>
      </body>
    </html>
  );
}
