# Deployment Leadfinder Sitora

## Hosting en domein

- Repository: `WesselHofenk/Leadfinder`
- Productiebranch: `main`
- Hosting: Vercel (Next.js server deployment)
- Primair domein: `https://leadfindersitora.nl`
- Redirect: `https://www.leadfindersitora.nl` naar het primaire domein
- DNS-provider en registrar: Vimexx

GitHub Pages is niet geschikt voor deze applicatie, omdat de app serverroutes, sessies, PostgreSQL en achtergrondtaken gebruikt. Het oude `public/CNAME`-bestand hoort daarom niet bij de productie-deployment.

## DNS bij Vimexx

Vervang uitsluitend de bestaande GitHub Pages-records voor de website. Laat alle MX-, SPF-, DKIM-, DMARC- en overige e-mailrecords ongewijzigd.

| Type | Naam/host | Waarde/doel | TTL |
|---|---|---|---:|
| A | `@` | `76.76.21.21` | `3600` |
| CNAME | `www` | `cname.vercel-dns-0.com` | `3600` |

Verwijder bij de omschakeling de vier oude GitHub Pages A-records (`185.199.108.153` t/m `185.199.111.153`) en vervang de oude `www`-CNAME naar `WesselHofenk.github.io`. Gebruik altijd de project-specifieke waarden die Vercel onder **Settings → Domains** toont als die afwijken van bovenstaande algemene Vercel-records.

Vercel verstrekt en vernieuwt het TLS-certificaat automatisch zodra beide hostnamen correct naar Vercel wijzen. De redirect van `www` naar het hoofddomein staat ook in `next.config.ts`.

## Environment variables

Stel deze waarden in Vercel in voor Production, Preview en Development waar relevant:

| Variabele | Vereist | Opmerking |
|---|---:|---|
| `DATABASE_URL` | ja | PostgreSQL connection string, inclusief SSL-instelling van de provider |
| `AUTH_SECRET` | ja | minimaal 32 willekeurige tekens |
| `CRON_SECRET` | ja | apart willekeurig secret van minimaal 32 tekens |
| `INITIAL_ADMIN_USERNAME` | eerste seed | standaard `sitoro` |
| `INITIAL_ADMIN_PASSWORD` | eerste seed | tijdelijk wachtwoord; nooit committen |
| `GOOGLE_PLACES_API_KEY` | voor scans | uitsluitend server-side Google Places API (New) key |
| `PAGESPEED_API_KEY` | voor analyse | uitsluitend server-side PageSpeed Insights key |
| `GOOGLE_PLACES_DAILY_LIMIT` | nee | standaard `250` |
| `GOOGLE_PLACES_MAX_PAGES_PER_JOB` | nee | standaard `2` |
| `PAGESPEED_DAILY_LIMIT` | nee | standaard `25` |
| `WEBSITE_OPPORTUNITY_THRESHOLD` | nee | standaard `55` |
| `SESSION_TTL_DAYS` | nee | standaard `14` |
| `NEXT_PUBLIC_APP_URL` | ja | `https://leadfindersitora.nl` |

Geheime waarden horen alleen in Vercel en een lokale, genegeerde `.env.local`; nooit in Git.

## Volgende deployment

1. Werk op een branch en open een pull request naar `main`.
2. Laat CI lint, typecheck, tests en de productie-build uitvoeren.
3. Merge naar `main`; de gekoppelde Vercel-repository start automatisch een productie-deployment.
4. De build voert `prisma migrate deploy`, de idempotente seed en `next build` uit.
5. Controleer in Vercel of de deployment Ready is en bekijk de Function Logs.
6. Test login, dashboard, leads, filters, pipeline, formulieren, mobiele layout, beide domeinen en HTTPS.

De drie Vercel-cronjobs draaien dagelijks en zijn daarmee compatibel met het Hobby-plan. Voor meerdere runs per dag is Vercel Pro nodig; pas dan de schema's in `vercel.json` aan.
