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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
