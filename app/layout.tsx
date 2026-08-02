import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import AccountMenu from "@/components/AccountMenu";
import HeaderSearch from "@/components/HeaderSearch";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

const DESCRIPTION =
  "Épinglez vos cartes Pokémon et retrouvez en un coup d’œil toutes les annonces Vinted qui les concernent, comparées à la cote Cardmarket.";

export const metadata: Metadata = {
  title: {
    default: "PokeBroc — vos cartes Pokémon et leurs offres Vinted",
    template: "%s | PokeBroc",
  },
  description: DESCRIPTION,
  applicationName: "PokeBroc",
  openGraph: {
    type: "website",
    siteName: "PokeBroc",
    locale: "fr_FR",
    title: "PokeBroc — vos cartes Pokémon et leurs offres Vinted",
    description: DESCRIPTION,
  },
  twitter: { card: "summary" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col bg-bg">
        <a
          href="#contenu"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-lg focus:bg-accent focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-accent-ink"
        >
          Aller au contenu
        </a>

        <header className="sticky top-0 z-40 border-b border-line bg-bg/90 backdrop-blur">
          <div className="mx-auto flex h-14 w-full max-w-[1360px] items-center gap-3 px-4">
            <Link href="/" className="flex shrink-0 items-center gap-2" aria-label="PokeBroc">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm font-black text-accent-ink">
                P
              </span>
              <span className="hidden text-[15px] font-bold tracking-tight sm:block">
                Poke<span className="text-accent">Broc</span>
              </span>
            </Link>

            {/* La recherche vit dans l'en-tête : ajouter une carte est l'action
                principale du site, elle doit rester à portée sur chaque page. */}
            <Suspense fallback={<div className="h-9 flex-1" />}>
              <HeaderSearch />
            </Suspense>

            <Suspense fallback={<div className="h-8 w-24 shrink-0" />}>
              <AccountMenu />
            </Suspense>
          </div>
        </header>

        <main id="contenu" className="mx-auto w-full max-w-[1360px] flex-1 px-4 py-6">
          {children}
        </main>

        <footer className="border-t border-line px-4 py-5 text-center text-[11px] text-faint">
          Cartes et cotes : TCGdex · Cardmarket — Annonces : Vinted. Projet personnel, sans
          affiliation.
        </footer>
      </body>
    </html>
  );
}
