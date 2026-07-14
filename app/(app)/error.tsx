"use client";
import { AlertTriangle } from "lucide-react";
export default function ErrorPage({reset}:{error:Error;reset:()=>void}){return <div className="content"><div className="card empty"><AlertTriangle size={34}/><strong>De gegevens konden niet worden geladen</strong><p>Controleer de databaseverbinding of probeer het opnieuw.</p><button className="button button-primary" onClick={reset}>Opnieuw proberen</button></div></div>}
