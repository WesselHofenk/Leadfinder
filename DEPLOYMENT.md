# Productiedeployment

De productieomgeving bestaat uit:

- Vercel-project `leadfinder`;
- GitHub-repository `WesselHofenk/Leadfinder`, production branch `main`;
- Neon PostgreSQL-resource `neon-pink-globe` in Frankfurt;
- hoofddomein `https://leadfindersitora.nl`.

## Verplichte Vercel-variabelen

De Neon-integratie beheert de databasewaarden. Bewaar nooit echte waarden in Git.

- `NEON_POSTGRES_PRISMA_URL`: pooled runtimeverbinding;
- `NEON_POSTGRES_URL_NON_POOLING`: directe verbinding voor Prisma-migraties;
- `AUTH_SECRET`: minimaal 32 willekeurige tekens;
- `CRON_SECRET`: minimaal 32 andere willekeurige tekens;
- `INITIAL_ADMIN_USERNAME` en `INITIAL_ADMIN_PASSWORD`: optioneel voor de eerste idempotente seed.

De overige begrensde generatorinstellingen staan in `.env.example`.

## Mailbox `info@sitora.nl`

Cold e-mail werkt pas nadat de volgende waarden als beveiligde Vercel-variabelen zijn ingesteld. Sla het mailboxwachtwoord nooit op in Git of in een lokaal gedeeld bestand.

- `COLD_EMAIL_FROM_ADDRESS=info@sitora.nl`;
- `COLD_EMAIL_FROM_NAME=Sitora`;
- `COLD_EMAIL_WARMUP_START=2026-08-04`;
- `COLD_EMAIL_TIME_ZONE=Europe/Amsterdam`;
- `MAIL_SMTP_HOST=mail.sitora.nl`, `MAIL_SMTP_PORT=587`, `MAIL_SMTP_SECURE=false`;
- `MAIL_IMAP_HOST=mail.sitora.nl`, `MAIL_IMAP_PORT=993`, `MAIL_IMAP_SECURE=true`;
- `MAIL_USERNAME=info@sitora.nl` en `MAIL_PASSWORD=<mailboxwachtwoord>`;
- `MAIL_SENT_FOLDER`: alleen invullen wanneer de IMAP-server de map met speciaal gebruik `Sent` niet publiceert.

De dagelijkse Vercel-cron start om 08:00 UTC de duurzame wachtrij; de applicatie zelf bewaakt 09:00–17:00 Nederlandse tijd en Vercel Queue activeert ieder individueel verzendmoment. De eerste campagne-run slaat de ingestelde startdatum duurzaam in PostgreSQL op. Het daglimiet begint bij 20, stijgt iedere zeven kalenderdagen met 10 en blijft vanaf week 9 op 100 staan.

De automatische campagne gebruikt uitsluitend leads in `Nieuw` en bewaart de A/B-volgorde, reserveringen, dagsamenvattingen en deduplicatiesleutels in PostgreSQL. Na SMTP-acceptatie zoekt de applicatie eerst op Message-ID in de echte IMAP-map Verzonden items en voegt alleen een kopie toe wanneer de provider dat niet al heeft gedaan. Alleen na IMAP-bevestiging gaat de lead naar `Gemaild`. Een mislukte IMAP-poging verstuurt de mail niet opnieuw, maar probeert uitsluitend de archiefkopie opnieuw op te slaan.

## Veilig migreren

`pnpm vercel-build` voert in deze volgorde uit:

1. Prisma Client genereren;
2. alleen nog niet toegepaste migraties uitvoeren met `prisma migrate deploy`;
3. categorieën en zoekgebieden idempotent seeden;
4. de Next.js-productiebundle bouwen.

Migraties mogen in productie geen `migrate reset`, `db push`, `DROP TABLE` of destructieve dataconversie uitvoeren. De migratie `20260715230000_production_ready_features` is additief; `20260715231000_normalize_legacy_statuses` normaliseert alleen oude statuswaarden. Beide behouden bestaande gebruikers, leads en runhistorie.

## Deployen

```bash
git push origin main
```

Vercel bouwt `main` als productie. Controleer daarna:

```bash
pnpm dlx vercel@latest ls leadfinder
pnpm dlx vercel@latest inspect <deployment-url>
```

Voer een smoke-test uit op login, dashboard, leadfilters, leadbewerking, generatorstatus en export. Controleer daarna via Neon dat dezelfde records na een nieuwe deployment of function-restart nog bestaan.

## Rollback

Promoveer bij een applicatiefout de vorige geslaagde Vercel-deployment. Draai een toegepaste migratie niet handmatig terug zolang de oude applicatie compatibel is met de additieve kolommen en tabellen. Maak vóór toekomstige destructieve migraties altijd een Neon-branch of herstelpunt.
