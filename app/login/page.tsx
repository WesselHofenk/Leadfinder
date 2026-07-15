import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { currentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { Brand } from "@/components/brand";
import { LoginForm } from "@/components/login-form";
import { ThemeToggle } from "@/components/theme-toggle";

export const dynamic = "force-dynamic";
export default async function LoginPage() {
  if (await currentUser()) redirect("/dashboard");
  if (await prisma.user.count() === 0) redirect("/setup");
  return <main className="login-shell"><section className="login-visual"><Brand/><div className="login-copy"><span className="eyebrow" style={{color:"#72d9b9"}}>Nederland & België</span><h1>Van openbare bedrijfsdata naar uitlegbare verkoopkansen.</h1><p style={{color:"#bad3ca",fontSize:17,lineHeight:1.7,maxWidth:520}}>Vind bedrijven zonder betaalde databronnen. Iedere classificatie toont het bewijs en de onzekerheid.</p><div className="setup-points">{["Veilige cloudopslag","Gratis openbare bronnen","Heldere pipeline en permanente notities"].map((item)=><span key={item}><CheckCircle2 size={17}/>{item}</span>)}</div></div><span className="small" style={{color:"#8eb0a3",position:"relative",zIndex:1}}>Leadfinder Sitora · beveiligde toegang</span></section><section className="login-panel"><ThemeToggle className="login-theme-toggle"/><div className="login-form"><span className="eyebrow">Welkom terug</span><h2>Log in op Leadfinder</h2><p className="muted">Alleen geautoriseerde gebruikers hebben toegang.</p><LoginForm/></div></section></main>;
}
