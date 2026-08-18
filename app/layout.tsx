import type { Metadata } from "next";
import "./globals.css";
import "./brief.css";

export const metadata: Metadata = {
  title: "Pursuit | Government Revenue Intelligence",
  description: "Government revenue intelligence for federal, state, local, K-12 and higher education markets.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
