import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gruas App - El Salvador",
  description: "Plataforma de solicitud de servicios de grua para El Salvador",
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
