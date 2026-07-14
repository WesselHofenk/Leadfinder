"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function LoginForm() {
  const router = useRouter(); const [error,setError] = useState(""); const [pending,setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    const response = await fetch("/api/auth/login", { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({username:form.get("username"),password:form.get("password")}) });
    const data = await response.json(); setPending(false); if (!response.ok) return setError(data.error || "Inloggen mislukt"); router.replace("/dashboard"); router.refresh();
  }
  return <form className="form-stack" onSubmit={submit}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="field"><label htmlFor="username">Gebruikersnaam</label><input className="input" id="username" name="username" autoComplete="username" required autoFocus/></div>
    <div className="field"><label htmlFor="password">Wachtwoord</label><input className="input" id="password" name="password" type="password" autoComplete="current-password" minLength={8} required/></div>
    <button className="button button-primary" style={{width:"100%",marginTop:4}} disabled={pending}>{pending ? <LoaderCircle className="animate-spin" size={17}/> : <>Veilig inloggen <ArrowRight size={16}/></>}</button>
  </form>;
}
