-- Add organizationId to Listing
ALTER TABLE "Listing" ADD COLUMN "organizationId" TEXT;

-- Backfill: set organizationId from the listing owner's primary org (earliest membership)
UPDATE "Listing" l
SET "organizationId" = (
  SELECT om."organizationId"
  FROM "OrganizationMember" om
  WHERE om."userId" = l."mentorId"
  ORDER BY om."joinedAt" ASC
  LIMIT 1
);

-- Add foreign key constraint
ALTER TABLE "Listing"
  ADD CONSTRAINT "Listing_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Index for org-scoped queries
CREATE INDEX "Listing_organizationId_idx" ON "Listing"("organizationId");
