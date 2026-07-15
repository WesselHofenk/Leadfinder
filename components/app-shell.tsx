"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BarChart3, Columns3, Database, LogOut, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";
import { ThemeToggle } from "./theme-toggle";

const links = [{href:"/dashboard",label:"Dashboard",icon:BarChart3},{href:"/leads",label:"Leads",icon:Database},{href:"/pipeline",label:"Pipeline",icon:Columns3},{href:"/account",label:"Account",icon:Settings}];
export function AppShell({ children, user }: { children: React.ReactNode; user: {name:string;username:string;role:string} }) {
  const pathname=usePathname(); const router=useRouter(); const [open,setOpen]=useState(false);
  const navigation = <><Brand/><nav className="nav">{links.map(({href,label,icon:Icon})=><Link key={href} href={href} aria-current={pathname.startsWith(href)?"page":undefined} onClick={()=>setOpen(false)}><Icon size={17}/>{label}</Link>)}{user.role==="ADMIN"&&<Link href="/admin" aria-current={pathname.startsWith("/admin")?"page":undefined} onClick={()=>setOpen(false)}><ShieldCheck size={17}/>Beheer</Link>}</nav><div className="sidebar-user"><div style={{display:"flex",alignItems:"center",gap:10}}><span className="avatar">{user.name.charAt(0).toUpperCase()}</span><span style={{minWidth:0}}><strong style={{display:"block",fontSize:13,color:"white"}}>{user.name}</strong><span style={{fontSize:11,color:"#9bb3aa"}}>{user.role==="ADMIN"?"Beheerder":"Gebruiker"}</span></span></div></div></>;
  async function logout(){await fetch("/api/auth/logout",{method:"POST"});router.replace("/login");router.refresh();}
  return <div className="app-grid"><aside className="sidebar">{navigation}</aside>{open&&<div className="mobile-scrim" onClick={()=>setOpen(false)}><aside className="sidebar" style={{display:"flex",width:270}} onClick={e=>e.stopPropagation()}><button aria-label="Menu sluiten" className="button sidebar-close" onClick={()=>setOpen(false)}><X/></button>{navigation}</aside></div>}<main className="main"><header className="topbar"><button className="button button-secondary mobile-menu" aria-label="Menu openen" onClick={()=>setOpen(true)}><Menu size={18}/></button><span className="small muted hide-mobile">Kwalitatieve websitekansen in Nederland en België</span><div className="topbar-actions"><span className="small hide-mobile">@{user.username}</span><ThemeToggle/><button className="button button-secondary" onClick={logout}><LogOut size={15}/><span className="hide-mobile">Uitloggen</span></button></div></header>{children}</main></div>;
}
