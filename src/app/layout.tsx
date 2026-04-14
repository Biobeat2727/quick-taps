import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Quick Taps",
  description: "Always-on bar mini games at IPA, Coeur d'Alene",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
