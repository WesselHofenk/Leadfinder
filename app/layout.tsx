import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: { default: "Leadfinder Sitora", template: "%s · Leadfinder Sitora" }, description: "Geverifieerde bedrijfsleads uit Nederland en België." };
const themeInitializer = `(function(){try{var saved=localStorage.getItem("leadfinder-theme");var theme=saved==="dark"||saved==="light"?saved:(window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light");document.documentElement.dataset.theme=theme;document.documentElement.style.colorScheme=theme;}catch(e){document.documentElement.dataset.theme="light";}})();`;
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="nl" suppressHydrationWarning><head><meta name="color-scheme" content="dark light"/><script dangerouslySetInnerHTML={{__html:themeInitializer}}/></head><body>{children}</body></html>;
}
