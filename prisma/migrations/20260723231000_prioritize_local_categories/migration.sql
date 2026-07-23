BEGIN;

-- Apply the requested defaults only to categories that still have the
-- untouched default value. User-managed custom priorities remain unchanged.
UPDATE "Category"
SET "priority" = 25, "updatedAt" = CURRENT_TIMESTAMP
WHERE "priority" = 100
  AND "slug" IN (
    'dakdekker',
    'schilder',
    'stukadoor',
    'tegelzetter',
    'loodgieter',
    'elektricien',
    'hovenier',
    'klusbedrijf',
    'installatiebedrijf',
    'schoonmaakbedrijf',
    'verhuisbedrijf',
    'kapper',
    'schoonheidssalon',
    'nagelstudio',
    'hondentrimmer',
    'hondenuitlaatservice'
  );

COMMIT;
