# Migratie naar zes pipelinefasen

De actieve verkooppipeline bestaat vanaf deze migratie uitsluitend uit:

1. Nieuw
2. Belletje 1
3. Belletje 2
4. Gemaild
5. Geen interesse
6. Klant

`lib/leads/pipeline.ts` is de centrale definitie voor de API-validatie, filters, formulieren, exports en het pipelinebord. Nieuwe gegenereerde en geïmporteerde leads gebruiken altijd `pipeline-nieuw`.

## Migratie van bestaande leads

| Oude fase of status | Nieuwe fase |
| --- | --- |
| Nieuw, leeg of onbekend | Nieuw |
| Interessant, Geïnteresseerd, Benaderd, Gebeld, Voicemail, Belletje 3 | Belletje 1 |
| Reactie ontvangen, Terugbellen, Terugbel verzoek, Ingepland | Belletje 2 |
| Mail gestuurd (nog te bellen), Offerte gestuurd, Belletje 4 | Gemaild |
| Niet interessant, Niet relevant | Geen interesse |
| Deal, Klant geworden | Klant |

De migratie `20260723210000_six_stage_pipeline`:

- draait volledig in één transactie;
- vergrendelt de lead- en fasetabellen tijdens de korte omschakeling;
- verwijdert geen leads, notities, historie of gekoppelde gegevens;
- registreert iedere gewijzigde fase als `PIPELINE_STAGE_MIGRATED`;
- bewaart een verdeling voor en na in `PipelineMigrationAudit`;
- breekt af als het leadaantal wijzigt, een lead geen geldige actieve fase heeft of niet exact zes actieve fasen overblijven;
- houdt oude fasen inactief beschikbaar voor historische referenties.
