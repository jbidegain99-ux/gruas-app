import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Budi - Admin Portal",
  description: "Plataforma de gestion de servicios de asistencia vehicular",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
