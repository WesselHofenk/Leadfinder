import "server-only";

import { Prisma } from "@prisma/client";

/** Canonical definition shared by scheduling, dashboard counts and lead-buffer control. */
export function coldEmailEligibleLeadWhere(): Prisma.LeadWhereInput {
  return {
    isActive: true,
    isFiltered: false,
    isSuppressed: false,
    doNotContact: false,
    email: { not: null },
    emailMxVerified: true,
    emailValidationStatus: { not: "INVALID" },
    pipelineStage: { is: { slug: "nieuw" } },
    coldEmails: { none: {
      OR: [
        { smtpAcceptedAt: { not: null } },
        { status: { in: ["PENDING", "SENDING", "SENT_PENDING_ARCHIVE", "SENT", "FAILED"] } },
      ],
    } },
  };
}
