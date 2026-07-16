import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve("prisma/migrations/20260716163000_seven_stage_sales_pipeline/migration.sql"), "utf8");
const notInterestedMigration = readFileSync(resolve("prisma/migrations/20260716170000_add_not_interested_pipeline_status/migration.sql"), "utf8");
const relationalMigration = readFileSync(resolve("prisma/migrations/20260716210000_relational_pipeline_stages/migration.sql"), "utf8");
const emailedStageMigration = readFileSync(resolve("prisma/migrations/20260716234500_add_emailed_pipeline_stage/migration.sql"), "utf8");
const callbackRequestStageMigration = readFileSync(resolve("prisma/migrations/20260716235900_add_callback_request_pipeline_stage/migration.sql"), "utf8");

describe("veilige pipeline-datamigratie", () => {
  it.each([
    ["NEW", "NEW"], ["NEEDS_REVIEW", "NEW"], ["VERIFIED", "NEW"],
    ["CALLED", "VOICEMAIL"], ["NO_ANSWER", "VOICEMAIL"], ["WON", "CUSTOMER"], ["INVOICED", "CUSTOMER"],
    ["CALL_BACK", "CALL_BACK"], ["INTERESTED", "INTERESTED"], ["APPOINTMENT", "APPOINTMENT"], ["QUOTE_SENT", "QUOTE_SENT"],
    ["LOST", "NEW"], ["REJECTED", "NEW"], ["HAS_WEBSITE", "NEW"], ["PERMANENTLY_CLOSED", "NEW"], ["DO_NOT_CONTACT", "NEW"], ["FILTERED", "NEW"],
  ])("migreert %s naar %s", (oldStatus, newStatus) => {
    expect(migration).toContain(`WHEN '${oldStatus}' THEN '${newStatus}'`);
  });

  it("migreert overige oude fases naar Nieuw zonder leads te verwijderen", () => {
    expect(migration).toContain("ELSE 'NEW'");
    expect(migration).not.toMatch(/DELETE\s+FROM|TRUNCATE/i);
    expect(migration).toContain('ALTER COLUMN "status" TYPE "LeadStatus_new"');
  });

  it("voegt Niet geïnteresseerd toe zonder bestaande leads te wijzigen of verwijderen", () => {
    expect(notInterestedMigration).toContain("ADD VALUE IF NOT EXISTS 'NOT_INTERESTED'");
    expect(notInterestedMigration).not.toMatch(/UPDATE|DELETE\s+FROM|TRUNCATE/i);
  });
  it("maakt exact acht canonieke relationele fases in een transactie", () => {
    expect(relationalMigration).toMatch(/^BEGIN;/);
    expect(relationalMigration.trim()).toMatch(/COMMIT;$/);
    for (const slug of ["nieuw","belletje-1","belletje-2","belletje-3","belletje-4","ingepland","deal","geen-interesse"]) expect(relationalMigration).toContain(`'${slug}'`);
    expect(relationalMigration).toContain("active_stages <> 8");
  });

  it("bewaakt het leadaantal en verwijdert of overschrijft geen lead", () => {
    expect(relationalMigration).toContain("before_total <> after_total");
    expect(relationalMigration).not.toMatch(/DELETE\s+FROM\s+"Lead"|TRUNCATE/i);
    expect(relationalMigration).toContain('CREATE TABLE IF NOT EXISTS "PipelineMigrationAudit"');
  });

  it("voegt Gemaild veilig op positie 6 toe zonder bestaande leads te wijzigen", () => {
    expect(emailedStageMigration).toMatch(/^BEGIN;/);
    expect(emailedStageMigration.trim()).toMatch(/COMMIT;$/);
    expect(emailedStageMigration).toContain("('pipeline-gemaild', 'gemaild', 'Gemaild', 6");
    expect(emailedStageMigration).toContain("lead_count_before <> lead_count_after");
    expect(emailedStageMigration).not.toMatch(/UPDATE\s+"Lead"|DELETE\s+FROM\s+"Lead"|TRUNCATE/i);
    expect(emailedStageMigration).toContain("WHEN 'ingepland' THEN 7");
    expect(emailedStageMigration).toContain("WHEN 'geen-interesse' THEN 9");
  });

  it("voegt Terugbel verzoek veilig op positie 10 toe zonder bestaande leads te wijzigen", () => {
    expect(callbackRequestStageMigration).toMatch(/^BEGIN;/);
    expect(callbackRequestStageMigration.trim()).toMatch(/COMMIT;$/);
    expect(callbackRequestStageMigration).toContain("('pipeline-terugbel-verzoek', 'terugbel-verzoek', 'Terugbel verzoek', 10");
    expect(callbackRequestStageMigration).toContain("lead_count_before <> lead_count_after");
    expect(callbackRequestStageMigration).not.toMatch(/UPDATE\s+"Lead"|DELETE\s+FROM\s+"Lead"|TRUNCATE/i);
    expect(callbackRequestStageMigration).toContain("callback_stage_count <> 1");
  });
});
