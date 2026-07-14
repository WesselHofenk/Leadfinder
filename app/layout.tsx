import type { Metadata } from "next";import "./globals.css";import { Toaster } from "sonner";
export const metadata:Metadata={title:{default:"Sitora Leadfinder",template:"%s | Sitora"},description:"Vind en beoordeel zakelijke kansen in Nederland."};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="nl"><body><a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-white focus:p-3">Naar inhoud</a>{children}<Toaster richColors position="bottom-right"/></body></html>}
