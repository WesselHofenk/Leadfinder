# Codex-prompt: Lead Finder betrouwbaar herstellen

Werk zelfstandig in deze Lead Finder-repository en lever de reparatie volledig werkend op. Inspecteer eerst de bestaande implementatie, database, tests en Vercel-configuratie. Behoud bestaande gebruikersdata en raak geen bestaande leads destructief aan.

## Gewenst resultaat

Een normale klik op **Nieuwe leads genereren** moet een duurzame achtergrondrun starten die uiteindelijk exact 10 nieuwe, volledig gekwalificeerde leads als één atomaire batch in pipelinefase **Nieuw** opslaat. De browser hoeft niet open te blijven. Als een volledige batch nog niet haalbaar is, moeten geldige concepten en onzekere kandidaten veilig bewaard blijven voor een vervolgrun; toon nooit ten onrechte dat de run volledig klaar is.

## Harde kwalificatie-eisen

Bewaar een nieuwe lead alleen als al deze punten opnieuw zijn gecontroleerd vlak voor de definitieve database-insert:

1. Het bedrijf is aantoonbaar actief.
2. Het bedrijf is Nederlandstalig en ligt in Nederland of Nederlandstalig Vlaanderen.
3. Brussel, het Brussels Hoofdstedelijk Gewest, Gent en Gentse deelgemeenten blijven altijd uitgesloten.
4. Er is een volledig, normaal bedrijfsadres en precies één fysieke vestiging is bevestigd.
5. Er is een geldig openbaar telefoonnummer in E.164-formaat.
6. Er is een openbaar gevonden zakelijk e-mailadres met bron-URL en een geldige MX-controle. Raad nooit e-mailadressen.
7. Er is geen sterke duplicaatmatch met een bestaande lead of een andere kandidaat in dezelfde batch.
8. Het bedrijf heeft:
   - geen eigen website, betrouwbaar bevestigd; of
   - een aantoonbaar verouderde website; of
   - een aantoonbaar kapotte website; of
   - meerdere objectieve, concrete verbeterpunten.
9. Eén timeout, blokkade, DNS-fout of HTTP 403 is nooit voldoende bewijs dat een website ontbreekt of kapot is.
10. Sla de kwalificatiereden, contactvalidatiestatus, validatiebron, controledatum en websitebewijs op.

## Zoekbronnen en foutafhandeling

- Gebruik gratis openbare bronnen, waaronder OpenStreetMap/Overpass.
- Zoek zowel in Nederland als in echte Vlaamse dekkingsgebieden.
- Sluit kandidaten met een website niet vooraf uit; controleer eerst de websitekwaliteit.
- Begrens requests, responsegrootte, retries, backoff en paralleliteit.
- Roteer Overpass-hosts na 429, 5xx, timeouts en ongeldige responses.
- Verhoog de duurzame zoekcursor alleen na een geldige bronresponse.
- Markeer een mislukte zoekbatch niet als uitgeput. Een volgende run moet hetzelfde duurzame segment opnieuw kunnen proberen.
- Laat een tijdelijk defecte bron nooit eerder gevonden concepten of retrykandidaten verwijderen.
- Rapporteer bronrequests, successen, fouten, gecontroleerde kandidaten, afwijzingen, concepten en definitief opgeslagen leads afzonderlijk.

## Serverless en achtergrondverwerking

- Verwerk kleine, hervatbare batches met een database-lock en lease.
- Herstel verlopen locks en kandidaten die tijdens een onderbroken batch op `PROCESSING` bleven staan.
- Publiceer na iedere actieve batch een nieuw, idempotent bericht op een duurzame Vercel Queue.
- Gebruik een private queue-consumer met automatische retries; laat een Vercel-functie zichzelf niet rechtstreeks via HTTP aanroepen, omdat Vercels recursiebeveiliging zulke ketens met HTTP 508 stopt.
- Gebruik een stabiele idempotentiesleutel per run en voltooid batchnummer, zodat dubbele bezorging nooit dubbele verwerking of opslag veroorzaakt.
- Bescherm eventuele handmatige cron-fallbacks met een constant-time gecontroleerd geheim.
- Houd iedere Vercel-functie binnen de ingestelde maximale duur.
- De UI mag alleen pollen en mag niet verantwoordelijk zijn voor het voortzetten van de run; een stale-run-watchdog mag hooguit hetzelfde idempotente queuebericht opnieuw aanbieden.
- De dagelijkse cron mag een actieve run hervatten, maar mag die niet na één batch ten onrechte als voltooid markeren.

## Atomaire opslag

- Bewaar gekwalificeerde concepten duurzaam in PostgreSQL.
- Hergebruik recente concepten in een volgende run.
- Hercontroleer vóór publicatie minimaal e-mail/MX, websitebeslissing, status, locatie, taal, telefoon en duplicaten.
- Publiceer alleen wanneer exact het doel van 10 geldige concepten aanwezig is.
- Schrijf de 10 leads in één serialiseerbare transactie naar pipelinefase **Nieuw**.
- Bij één fout of ongeldig concept moet de hele definitieve batch terugrollen; verwijder alleen het ongeldige concept en vul verder aan.
- Voeg databasewijzigingen uitsluitend via additieve Prisma-migraties toe.

## Websitebeveiliging

- Sta alleen `http` en `https` toe.
- Blokkeer credentials in URL’s, localhost, metadatahosts, private/reserved IPv4- en IPv6-adressen en IPv4-mapped IPv6.
- Resolveer DNS vóór ieder request.
- Controleer iedere redirectbestemming opnieuw om SSRF en DNS-rebinding te voorkomen.
- Begrens redirects, tijd, responsegrootte en gedownloade inhoud.

## Verificatie

Voeg of actualiseer tests voor:

- verplichte e-mail met bron en MX;
- Nederlands en Vlaams toegestaan, Frans/Wallonië en geblokkeerde regio’s afgewezen;
- bruikbare, verouderde, kapotte, verbeterbare en tijdelijk onbereikbare websites;
- private adressen en private redirectbestemmingen;
- cursor alleen doorzetten na bronsucces;
- bronfallback, retries en tijdelijke uitval;
- duurzame retryqueue en stale-lockherstel;
- exact 10 als enige succesvolle atomaire batchgrootte;
- duplicaten binnen de batch en tegen bestaande leads;
- duurzame queue, dubbele berichtbezorging, automatische retries en browseronafhankelijke voortzetting;
- eerlijke UI-meldingen voor gedeeltelijk, timeout, bronuitval en voltooid.

Voer daarna achtereenvolgens uit:

1. Prisma formattering en clientgeneratie.
2. Typecheck.
3. Lint.
4. Alle unit- en integratietests.
5. Productiebuild.
6. Een echte openbare-bron-smoketest.

Los alle regressies op; verlaag geen kwaliteitseisen om tests groen te krijgen.

## Publicatie en eindrapport

- Commit de wijzigingen op een aparte branch.
- Push de branch en open een concept-PR.
- Rol de gecontroleerde versie uit naar het bestaande Vercel-productieproject.
- Controleer migraties, deploymentstatus en productiepagina.
- Start één echte productierun en volg die totdat exact 10 leads zijn opgeslagen of een aantoonbare externe blokkade resteert.
- Meld tot slot beknopt:
  - waardoor eerdere runs maar weinig leads vonden;
  - wat in zoeken, kwalificatie, opslag, achtergrondverwerking, beveiliging en UI is veranderd;
  - hoeveel tests slaagden;
  - de productie-URL en deploymentstatus;
  - het resultaat van de echte productierun;
  - eventuele resterende externe beperking, met concrete cijfers en zonder succes te suggereren als het doel niet is gehaald.
