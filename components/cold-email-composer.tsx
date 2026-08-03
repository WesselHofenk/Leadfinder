"use client";
import { useState } from "react";
import { Clock3, LoaderCircle, Send } from "lucide-react";
import { useRouter } from "next/navigation";

export function ColdEmailComposer({ leadId, recipient, companyName, immediateAllowed }: {
  leadId: string;
  recipient: string;
  companyName: string;
  immediateAllowed: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(formElement: HTMLFormElement, sendImmediately: boolean) {
    setPending(true);
    setMessage("");
    const form = new FormData(formElement);
    const response = await fetch(`/api/leads/${leadId}/email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: form.get("subject"), bodyText: form.get("bodyText"), sendImmediately }),
    });
    const data = await response.json().catch(() => ({}));
    setPending(false);
    if (response.ok) {
      setMessage(sendImmediately
        ? "E-mail verzonden, opgeslagen in Verzonden items en de pipeline is bijgewerkt."
        : `E-mail ingepland voor ${new Date(data.email.scheduledFor).toLocaleString("nl-NL")}.`);
      router.refresh();
    } else {
      setMessage(data.error || "E-mailactie mislukt.");
    }
  }

  return <form className="card card-pad form-stack" onSubmit={(event) => { event.preventDefault(); void submit(event.currentTarget, false); }}>
    <div><h2>Cold e-mail</h2><p className="small muted">Van info@sitora.nl naar {recipient}. De fase Gemaild volgt alleen na geslaagde verzending én opslag in Verzonden items.</p></div>
    <div className="field"><label htmlFor="coldEmailSubject">Onderwerp</label><input className="input" id="coldEmailSubject" name="subject" maxLength={180} required placeholder={`Een idee voor ${companyName}`} /></div>
    <div className="field"><label htmlFor="coldEmailBody">E-mailtekst</label><textarea className="textarea" id="coldEmailBody" name="bodyText" maxLength={10000} required rows={10} placeholder="Schrijf hier de definitieve persoonlijke e-mail…" /></div>
    <div className="actions">
      <button className="button button-primary" type="submit" disabled={pending}>{pending ? <LoaderCircle className="animate-spin" size={15} /> : <Clock3 size={15} />}Inplannen</button>
      {immediateAllowed && <button className="button button-secondary" type="button" disabled={pending} onClick={(event) => { if (event.currentTarget.form) void submit(event.currentTarget.form, true); }}><Send size={15} />Nu versturen</button>}
    </div>
    {message && <span className="small muted" aria-live="polite">{message}</span>}
  </form>;
}
