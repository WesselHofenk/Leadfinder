import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Leadfinder Sitora", template: "%s · Leadfinder Sitora" }, description: "Geverifieerde bedrijfsleads uit Nederland en België." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl"><body>{children}</body></html>;
}
