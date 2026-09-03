import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pursuit | Low Voltage Intelligence",
  description: "Low-voltage market intelligence for projects before the RFP, live pursuits, rebids, incumbents and product specifications.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
