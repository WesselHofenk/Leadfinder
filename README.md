# Sitora Leadfinder

Een openbare Nederlandse leadfinder voor het zoeken, selecteren, opslaan en exporteren van bedrijfsleads. De app heeft bewust geen login, registratie, gebruikersprofiel of afgeschermde routes.

## Starten

1. Installeer Node.js 20+ en pnpm.
2. Kopieer `.env.example` naar `.env.local`.
3. Voer `pnpm install` uit.
4. Start met `pnpm dev` en open `http://localhost:3001`.

De homepage opent direct met een lege leadpipeline. De knop **Nieuwe leads genereren** zoekt live in openbare OpenStreetMap-bedrijfsvermeldingen en heeft geen API-sleutel nodig.

De productieomgeving draait als statische Next.js-export op GitHub Pages. Zie `DEPLOYMENT.md` voor domein-, DNS- en redeploy-instructies.

## Leadselectie

- Alleen bedrijfsvermeldingen zonder `website`, `contact:website` of vergelijkbare websitevelden worden toegelaten.
- Een bronvermeld en technisch geldig telefoonnummer is verplicht.
- Sluitings- en lifecycle-tags worden geweigerd.
- Bekende grote ketens, franchisetags en namen met meerdere vestigingen in dezelfde resultatenset worden geweigerd.
- Provider-ID, genormaliseerd telefoonnummer en naam-adrescombinatie worden blijvend gebruikt voor deduplicatie.
- Iedere generatierun roteert naar andere Nederlandse regio's en voegt nooit eerder geziene kandidaten toe.

## Lokale opslag

Leads, statussen en de geschiedenis van eerder gecontroleerde bedrijfs-ID's worden in `localStorage` bewaard. Oude demo-leads worden bij de migratie verwijderd. Er worden geen accounts of sessies aangemaakt.

OpenStreetMap is een openbare, door gebruikers onderhouden bron. Een opgenomen telefoonnummer is bronvermeld en syntactisch gecontroleerd, maar bereikbaarheid kan zonder aparte telefoondienst niet gegarandeerd worden. Het ontbreken van een website betekent dat er in de geraadpleegde bedrijfsvermelding geen eigen websiteveld aanwezig was.

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
