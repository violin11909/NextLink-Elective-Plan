import type { Metadata } from "next";
import { Inter, Noto_Sans_Thai } from "next/font/google";
import "./globals.css";
import { PlanProvider } from "@/lib/use-plan-state";
import { getPlanPayload } from "@/lib/plan-data";

/**
 * Two families, one stack. The browser resolves per glyph, so Latin renders in
 * Inter and Thai falls through to Noto Sans Thai — Inter carries no Thai
 * glyphs, and without this the Thai text silently used whatever the OS
 * happened to supply.
 */
const latin = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-latin",
  display: "swap",
});

const thai = Noto_Sans_Thai({
  subsets: ["thai"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-thai",
  display: "swap",
});

export const metadata: Metadata = {
  title: "NextLink · แผนตารางสอนวิชาเลือก",
  description: "ระบบวางแผนตารางสอนวิชาเลือก ภาควิชาวิศวกรรมคอมพิวเตอร์",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="th" className={`${latin.variable} ${thai.variable}`}>
      <body><PlanProvider payload={getPlanPayload()}>{children}</PlanProvider></body>
    </html>
  );
}
