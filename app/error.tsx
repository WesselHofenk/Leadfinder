"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="login-shell">
      <section className="login-visual">
        <Brand />
        <div className="login-copy">
          <span className="eyebrow" style={{ color: "#72d9b9" }}>Leadfinder Sitora</span>
          <h1>Je gegevens blijven veilig bewaard.</h1>
          <p style={{ color: "#bad3ca", fontSize: 17, lineHeight: 1.7, maxWidth: 520 }}>
            De databaseverbinding is tijdelijk niet beschikbaar. Er worden geen leads verwijderd of overschreven.
          </p>
        </div>
        <span className="small" style={{ color: "#8eb0a3", position: "relative", zIndex: 1 }}>Beveiligde toegang</span>
      </section>
      <section className="login-panel">
        <ThemeToggle className="login-theme-toggle" />
        <div className="login-form">
          <AlertTriangle size={32} aria-hidden="true" />
          <span className="eyebrow">Tijdelijk onderhoud</span>
          <h2>Leadfinder kan de database niet bereiken</h2>
          <p className="muted">Wacht een ogenblik en probeer het opnieuw. Als het probleem blijft bestaan, controleert Sitora de databasecapaciteit.</p>
          <button className="button primary" type="button" onClick={reset}>
            <RotateCcw size={17} /> Opnieuw proberen
          </button>
        </div>
      </section>
    </main>
  );
}
