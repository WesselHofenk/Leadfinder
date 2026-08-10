-- Keep the pipeline synchronized with accepted cold-email deliveries.
-- Only NEW leads are advanced, so later pipeline stages are never downgraded.
CREATE OR REPLACE FUNCTION sync_sent_outreach_to_emailed_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."status" = 'SENT' THEN
    UPDATE "Lead"
    SET
      "status" = 'EMAILED',
      "lastContactAt" = COALESCE(
        GREATEST("lastContactAt", NEW."sentAt"),
        "lastContactAt",
        NEW."sentAt",
        CURRENT_TIMESTAMP
      ),
      "updatedAt" = CURRENT_TIMESTAMP
    WHERE "id" = NEW."leadId"
      AND "status" = 'NEW';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_sent_outreach_to_emailed_lead_trigger ON "OutreachEmail";

CREATE TRIGGER sync_sent_outreach_to_emailed_lead_trigger
AFTER INSERT OR UPDATE ON "OutreachEmail"
FOR EACH ROW
WHEN (NEW."status" = 'SENT')
EXECUTE FUNCTION sync_sent_outreach_to_emailed_lead();

-- Repair every historic successful send that is still incorrectly shown in NEW.
UPDATE "Lead" AS lead
SET
  "status" = 'EMAILED',
  "lastContactAt" = COALESCE(
    GREATEST(lead."lastContactAt", sent."sentAt"),
    lead."lastContactAt",
    sent."sentAt",
    CURRENT_TIMESTAMP
  ),
  "updatedAt" = CURRENT_TIMESTAMP
FROM (
  SELECT "leadId", MAX("sentAt") AS "sentAt"
  FROM "OutreachEmail"
  WHERE "status" = 'SENT'
  GROUP BY "leadId"
) AS sent
WHERE lead."id" = sent."leadId"
  AND lead."status" = 'NEW';
