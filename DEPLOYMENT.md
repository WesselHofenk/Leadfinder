# Deployment leadfindersitora.nl

## Hosting en domein

- Hosting: GitHub Pages via `.github/workflows/pages.yml`
- Repository: `WesselHofenk/Leadfinder`
- Productie-URL: `https://leadfindersitora.nl`
- Canoniek domein: `leadfindersitora.nl`
- `www.leadfindersitora.nl` verwijst via GitHub Pages door naar het canonieke domein.
- Dit project staat volledig los van `sitora.nl`; wijzig voor deze deployment geen DNS- of repository-instellingen van `sitora.nl`.

GitHub Pages publiceert een statische Next.js-export. De primaire generator vraagt in de browser live openbare bedrijfsvermeldingen op via de Overpass API van OpenStreetMap. Er is geen login en er worden geen accounts of sessies aangemaakt. Leads, statussen en deduplicatiegeschiedenis blijven in `localStorage` van de browser.

## Vimexx DNS-records

Stel deze records in voor alleen de zone `leadfindersitora.nl`:

| Type | Naam/host | Waarde/doel | TTL |
| --- | --- | --- | --- |
| A | `@` | `185.199.108.153` | `3600` |
| A | `@` | `185.199.109.153` | `3600` |
| A | `@` | `185.199.110.153` | `3600` |
| A | `@` | `185.199.111.153` | `3600` |
| CNAME | `www` | `WesselHofenk.github.io` | `3600` |

Verwijder geen MX-, SPF-, DKIM-, DMARC- of andere e-mailrecords. Verwijder alleen conflicterende A/AAAA/CNAME-records voor exact `@` of `www` wanneer die nog naar een oude webhost wijzen.

Het bestand `public/CNAME` bevat `leadfindersitora.nl` en wordt automatisch in de Pages-artifact opgenomen. Nadat GitHub het certificaat heeft uitgegeven, moet in **Repository settings → Pages** de optie **Enforce HTTPS** aanstaan. GitHub verzorgt daarna het TLS-certificaat en de HTTP-naar-HTTPS-redirect.

## Environment variables

De Pages-buildconfiguratie stelt de publieke productievariabelen in:

- `NEXT_PUBLIC_APP_URL=https://leadfindersitora.nl`
- `NEXT_PUBLIC_STATIC_EXPORT=true`
- `GITHUB_PAGES=true`
- `GITHUB_PAGES_BASE_PATH=`

Voor de primaire OpenStreetMap-generator is geen API-sleutel nodig. `GOOGLE_PLACES_API_KEY` blijft alleen een server-side placeholder voor een eventuele toekomstige koppeling en wordt niet gebruikt of gepubliceerd op GitHub Pages. Commit nooit een echte sleutel.

## Volgende deployment

1. Maak wijzigingen op een aparte branch.
2. Voer `pnpm test`, `pnpm lint`, `pnpm typecheck` en `pnpm build` uit.
3. Merge de gecontroleerde wijziging naar `main`.
4. De workflow **Deploy GitHub Pages** bouwt de statische export en publiceert die automatisch.
5. Controleer de workflow onder **Actions** en daarna `https://leadfindersitora.nl` en `https://www.leadfindersitora.nl`.

Handmatig opnieuw publiceren kan via **Actions → Deploy GitHub Pages → Run workflow**.
