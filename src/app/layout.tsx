import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Larrs — Paneles internos",
  description: "Producción, pedidos y gestión interna · Heladería Larrs",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
