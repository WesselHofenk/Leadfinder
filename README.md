# Leadfinder Sitora

Leadfinder Sitora is een Next.js-app voor het vinden en handmatig verifiëren van Nederlandse en Belgische bedrijfsleads. De productieomgeving draait op Vercel met persistente PostgreSQL-opslag in Neon.

## Belangrijkste garanties

- Alleen leads met `NO_WEBSITE_CONFIRMED`, een handmatige Google-controle en expliciet `googleWebsitePresent = false` verschijnen als actieve leads.
- Een gevonden eigen website wordt geregistreerd en uitgesloten van de filter “Geen eigen website”.
- Onzekere, geblokkeerde of mislukte controles gaan naar handmatige controle en worden nooit automatisch als “geen website” gepubliceerd.
- Filters worden in PostgreSQL toegepast vóór paginering en export.
- Accounts, leads, notities, verificatiebewijs en CRM-statussen blijven persistent over deployments en herstarts.

## Lokaal ontwikkelen

Vereist: Node.js 20–24, pnpm en een aparte PostgreSQL-developmentdatabase.

1. Kopieer `.env.example` naar `.env.local`.
2. Vul een pooled en directe Neon-development-URL in.
3. Start de app:

```bash
pnpm install
pnpm db:setup
pnpm dev
```

Open `http://localhost:3001`. Als de database nog geen gebruiker bevat, verschijnt de eenmalige beheerder-setup.

Gebruik nooit de productie-URL voor lokaal ontwikkelen of tests.

## Websiteverificatie

De pipeline controleert opgeslagen websitevelden, onderscheidt eigen domeinen van externe profielen en kan plausibele merkdomeinen begrensd via DNS en HTTP controleren. Time-outs, 403-responses en andere onzekere uitkomsten worden als handmatige controle behandeld.

Google wordt niet automatisch gescrapet. Een gebruiker opent de Google-bedrijfspagina en bevestigt expliciet of een eigen website aanwezig is. Daardoor kan een leeg bronveld nooit zelfstandig een actieve lead opleveren.

## Kwaliteitscontrole

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

## Productie

Zie [DEPLOYMENT.md](./DEPLOYMENT.md) voor databasevariabelen, migraties, deployment en rollback.

## Privacy en brongebruik

Verwerk en exporteer alleen persoonsgegevens waarvoor een geldige zakelijke grondslag bestaat. Voeg uitsluitend databronnen toe waarvan geautomatiseerde toegang is toegestaan; captcha’s, loginmuren, robotsregels en anti-botmaatregelen mogen niet worden omzeild.
