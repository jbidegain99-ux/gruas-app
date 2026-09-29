import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

// Fuentes autoalojadas por Next (sin petición a Google en el navegador).
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["600", "700", "800"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Budi", template: "%s · Budi" },
  description: "Asistencia vial en El Salvador: grúa, batería, llanta, combustible y más, con seguimiento en vivo.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es-SV" className={`${inter.variable} ${jakarta.variable}`}>
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
