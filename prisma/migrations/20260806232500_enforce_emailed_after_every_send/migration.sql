-- The pipeline rule is absolute: every successful cold-email send ends in EMAILED.
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
      AND "status" <> 'EMAILED';
  END IF;

  RETURN NEW;
END;
$$;

-- Repair all historic successful cold-email sends, regardless of their current stage.
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
  AND lead."status" <> 'EMAILED';
