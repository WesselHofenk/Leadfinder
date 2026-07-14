# Leadfinder Sitora

Interne, beveiligde Leadfinder voor kwalitatieve websitekansen in Nederland en België. Dit project staat technisch en inhoudelijk los van `sitora.nl`.

## Architectuur

- Next.js 15 App Router, React 19 en strikte TypeScript
- PostgreSQL met Prisma ORM en een reproduceerbare migratie
- Opaque databasesessies, bcrypt-wachtwoorden en HttpOnly/SameSite-cookies
- Google Places API (New), uitsluitend server-side en met expliciete field masks
- PageSpeed Insights API v5 plus begrensde DNS/HTTP/HTML-controles
- Vercel Cron voor incrementele Places-scans, hercontrole en websiteanalyse
- Zod-validatie, origincontrole, rate limiting, quota en transactionele job-locks
- Tailwind CSS 4 en een responsive zakelijke interface

Er worden nooit fictieve bedrijven in productie geseed. `prisma/seed.ts` maakt alleen de eerste gebruiker, categorieconfiguratie en geografische zoekgebieden aan.

## Lokaal starten

1. Installeer Node.js 20+, pnpm en PostgreSQL 16 (of start `docker compose up -d`).
2. Kopieer `.env.example` naar `.env.local` en vul de secrets in.
3. Voer `pnpm install` uit.
4. Voer `pnpm db:migrate` uit.
5. Voer `pnpm db:seed` uit.
6. Start `pnpm dev` en open `http://localhost:3001`.

De gewenste eerste gebruikersnaam is `sitoro`. Stel het tijdelijke wachtwoord uitsluitend in via `INITIAL_ADMIN_PASSWORD` voordat `pnpm db:seed` wordt uitgevoerd. Het wachtwoord wordt met bcrypt (cost 12) opgeslagen en staat nooit in Git. Na inloggen kan het onder **Account** worden gewijzigd.

## Environment variables

| Variabele | Vereist | Doel |
|---|---:|---|
| `DATABASE_URL` | ja | PostgreSQL connection string |
| `AUTH_SECRET` | ja | minimaal 32 willekeurige tekens |
| `CRON_SECRET` | ja | aparte bearer secret voor cronroutes |
| `INITIAL_ADMIN_USERNAME` | seed | standaard `sitoro` |
| `INITIAL_ADMIN_PASSWORD` | seed | tijdelijk wachtwoord, nooit committen |
| `GOOGLE_PLACES_API_KEY` | scans | server-side Places API (New) key |
| `PAGESPEED_API_KEY` | analyse | server-side PageSpeed Insights key |
| `GOOGLE_PLACES_DAILY_LIMIT` | nee | standaard 250 calls per dag |
| `GOOGLE_PLACES_MAX_PAGES_PER_JOB` | nee | standaard 2, maximaal 3 |
| `PAGESPEED_DAILY_LIMIT` | nee | standaard 25 calls per dag |
| `WEBSITE_OPPORTUNITY_THRESHOLD` | nee | standaard 55/100 |
| `SESSION_TTL_DAYS` | nee | standaard 14 dagen |
| `NEXT_PUBLIC_APP_URL` | ja | productie: `https://leadfindersitora.nl` |

## Leadselectie en scoring

Google Places levert bedrijfsnaam, status, telefoon, adres, locatie, Place ID en website. Alleen Nederlandse en Belgische bedrijven met bruikbare naam, telefoon en adres gaan verder. Tijdelijk/permanent gesloten, irrelevante categorieën en duplicaten worden uitgesloten of gefilterd, niet hard verwijderd.

- `NO_WEBSITE`: score 95 en reden “Geen website gevonden”.
- `OUTDATED_WEBSITE`: analyse via PageSpeed mobiel/desktop en veilige HTML-signalen.

De Opportunity Score (0–100) telt meerdere transparante signalen op: onbereikbaar (60), zeer lage mobiele score (22), geen viewport (15), geen CTA (10), geen formulier (7), placeholder (28), oude copyrightvermelding (7), kapotte links (max. 16) en zeer trage respons (12). Eén klein probleem maakt een website dus niet automatisch een sterke lead. De geschatte conversiekwaliteit is expliciet een heuristische schatting, geen gemeten conversieratio.

## Automatische taken

- `/api/cron/sync`: elke vier uur één geprioriteerd coveragegebied.
- `/api/cron/analyze`: ieder uur één begrensde websiteanalysejob.
- `/api/cron/reverify`: dagelijks maximaal twintig verouderde leads.

Jobs hebben locks, retries met exponential backoff en harde daglimieten. Handmatige status, notities, niet-benaderenstatus en filterreden worden bij externe updates niet overschreven.

## Deployment

GitHub Pages kan deze applicatie niet uitvoeren: Pages ondersteunt geen Next.js-serverroutes, PostgreSQL, sessies of cronjobs. Gebruik een server-capabele Next.js-host zoals Vercel:

1. Importeer `WesselHofenk/Leadfinder` in Vercel.
2. Koppel een beheerde PostgreSQL-database.
3. Stel alle vereiste production environment variables in.
4. Laat `pnpm db:migrate && pnpm build` als buildcommand uitvoeren (`vercel.json`).
5. Voer eenmaal `pnpm db:seed` uit met het tijdelijke wachtwoord in de omgeving.
6. Voeg `leadfindersitora.nl` en `www.leadfindersitora.nl` toe aan Vercel Domains.
7. Vervang bij Vimexx de huidige GitHub Pages-DNS door de records die Vercel toont.
8. Controleer HTTPS en de redirect van `www` naar het hoofddomein.

## Validatie

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Tests gebruiken uitsluitend mocks en pure domeinfuncties; ze voeren geen betaalde Google-calls uit.
