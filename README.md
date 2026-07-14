# Sitora Leadfinder

Een openbare Nederlandse leadfinder voor het zoeken, selecteren, opslaan en exporteren van bedrijfsleads. De app heeft bewust geen login, registratie, gebruikersprofiel of afgeschermde routes.

## Starten

1. Installeer Node.js 20+ en pnpm.
2. Kopieer `.env.example` naar `.env.local`.
3. Voer `pnpm install` uit.
4. Start met `pnpm dev` en open `http://localhost:3000`.

De homepage opent direct als dashboard. De standaard mock-provider bevat 40 realistische fictieve Nederlandse bedrijven en heeft geen API-sleutel nodig.

## Providers

- `LEAD_PROVIDER=mock` werkt direct.
- Stel `GOOGLE_PLACES_API_KEY` uitsluitend server-side in voor een toekomstige Google Places-koppeling.
- Providerimplementaties staan in `lib/providers`; componenten roepen alleen de centrale leadservice aan.

## Lokale opslag

Opgeslagen leads, selecties, statussen, notities, zoekopdrachten en exportgeschiedenis worden in `localStorage` bewaard. Er worden geen accounts of sessies aangemaakt.

## Veiligheid

- Geen rechtstreekse Google Maps-scraping.
- Zoek- en audit-API’s hebben IP-gebaseerde rate limiting.
- De website-audit gebruikt een timeout en blokkeert private en lokale adressen.
- API-sleutels staan nooit hardcoded in frontendcomponenten.
- E-mailfunctionaliteit maakt alleen concepten en verzendt niets automatisch.

## Controle

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```
