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
