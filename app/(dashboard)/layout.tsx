import { AppShell } from "@/components/app-shell";import { AppStore } from "@/components/app-store";
export default function Layout({children}:{children:React.ReactNode}){return <AppStore><AppShell>{children}</AppShell></AppStore>}
