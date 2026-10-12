import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import Sidebar from "./components/Sidebar";
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
        <div className="shell">
          <Suspense fallback={<SidebarPlaceholder />}>
            <Sidebar />
          </Suspense>
          <div className="shell-main">
            <main className="container">{children}</main>
            <footer className="footer">
              Public sources only: GitHub, official job boards, and engineering articles found with Google Search. Scores are computed in code; Gemini Flash only writes the text.
            </footer>
          </div>
        </div>
      </body>
    </html>
  );
}

function SidebarPlaceholder() {
  return (
    <aside className="sidebar" aria-busy>
      <div className="brand">
        <span className="brand-mark" aria-hidden />
        <span>Tech Stack Scout<small>for FlowForge sales</small></span>
      </div>
      <div className="side-nav">
        {[0, 1, 2, 3, 4, 5].map((k) => <div key={k} className="side-link skeleton" style={{ minHeight: 34 }} />)}
      </div>
    </aside>
  );
}
