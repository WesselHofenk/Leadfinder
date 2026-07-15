"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle } from "lucide-react";

export function SetupForm() {
  const router = useRouter(); const [error, setError] = useState(""); const [pending, setPending] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setPending(true); setError(""); const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(["name", "username", "password", "confirmation"].map((key) => [key, form.get(key)]));
    const response = await fetch("/api/auth/setup", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    const data = await response.json(); setPending(false);
    if (!response.ok) return setError(data.error || "Lokale beheerder aanmaken mislukt.");
    router.replace("/dashboard"); router.refresh();
  }
  return <form className="form-stack" onSubmit={submit}>
    {error && <div className="alert" role="alert">{error}</div>}
    <div className="field"><label htmlFor="name">Naam</label><input className="input" id="name" name="name" minLength={2} maxLength={80} autoComplete="name" required autoFocus/></div>
    <div className="field"><label htmlFor="username">Gebruikersnaam</label><input className="input" id="username" name="username" minLength={3} maxLength={80} autoComplete="username" required/></div>
    <div className="field"><label htmlFor="password">Wachtwoord</label><input className="input" id="password" name="password" type="password" minLength={12} maxLength={200} autoComplete="new-password" required/><span className="field-hint">Minimaal 12 tekens. Dit wachtwoord blijft uitsluitend in je lokale database.</span></div>
    <div className="field"><label htmlFor="confirmation">Herhaal wachtwoord</label><input className="input" id="confirmation" name="confirmation" type="password" minLength={12} maxLength={200} autoComplete="new-password" required/></div>
    <button className="button button-primary" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" size={17}/> : <>Lokale omgeving beveiligen <ArrowRight size={16}/></>}</button>
  </form>;
}
