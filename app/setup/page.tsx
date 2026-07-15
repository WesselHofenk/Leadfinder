import { redirect } from "next/navigation";
import { Database, ShieldCheck } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { currentUser } from "@/lib/auth/session";
import { Brand } from "@/components/brand";
import { SetupForm } from "@/components/setup-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";
export default async function SetupPage() {
  if (await currentUser()) redirect("/dashboard");
  if (await prisma.user.count() > 0) redirect("/login");
  return <main className="login-shell"><section className="login-visual"><Brand/><div className="login-copy"><span className="eyebrow" style={{color:"#72d9b9"}}>Eerste start</span><h1>Maak je beveiligde beheeraccount.</h1><p style={{color:"#bad3ca",fontSize:17,lineHeight:1.7,maxWidth:520}}>Leads, bewijs, notities en instellingen worden veilig opgeslagen in de gekoppelde PostgreSQL-database.</p><div className="setup-points"><span><Database size={18}/>Persistente PostgreSQL-opslag</span><span><ShieldCheck size={18}/>Bcrypt-hash en veilige sessies</span></div></div><span className="small" style={{color:"#8eb0a3",position:"relative",zIndex:1}}>Leadfinder Sitora</span></section><section className="login-panel"><ThemeToggle className="login-theme-toggle"/><div className="login-form"><span className="eyebrow">Eenmalige configuratie</span><h2>Maak de beheerder aan</h2><p className="muted">Er staat geen standaardgebruikersnaam of wachtwoord in de code.</p><SetupForm/></div></section></main>;
}
