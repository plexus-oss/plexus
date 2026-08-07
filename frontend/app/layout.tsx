import type { Metadata } from "next";
import { Providers } from "@/context/providers";
import {
  Geist,
  Instrument_Serif,
  Space_Grotesk,
  Bagel_Fat_One,
} from "next/font/google";
import { ThemeScript } from "@/components/theme-script";
import "./globals.css";

const geistSans = Geist({
  subsets: ["latin"],
  weight: "400",
});

const instrumentSerif = Instrument_Serif({
  variable: "--instrument-serif",
  subsets: ["latin"],
  weight: "400",
});

const geistMono = Space_Grotesk({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-geist-mono",
});

// Bubble display face for fun mode. Only loaded for surfaces that
// opt in via `.h-bubble` / `var(--bubble-font)`; ignored otherwise.
const bagelFatOne = Bagel_Fat_One({
  variable: "--font-bagel-fat-one",
  subsets: ["latin"],
  weight: ["400"],
  display: "swap",
});

const TITLE = "Plexus - Data stack for hardware";
const DESCRIPTION =
  "Monitor robots, medical devices, industrial sensors, and aerospace telemetry with real-time AI-powered insights. Built for hardware teams.";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.plexus.company"),
  title: TITLE,
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    siteName: "Plexus",
    url: "https://app.plexus.company",
    title: TITLE,
    description: DESCRIPTION,
    // og:image is supplied automatically by app/opengraph-image.tsx
    // (shared/[token]/opengraph-image.tsx overrides it for shared links)
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body
        className={`${geistSans.className} ${instrumentSerif.variable} ${geistMono.variable} ${bagelFatOne.variable} antialiased bg-white dark:bg-black text-gray-900 dark:text-white`}
      >
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
