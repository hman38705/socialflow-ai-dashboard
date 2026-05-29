-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "organizationId" TEXT;

-- CreateIndex
CREATE INDEX "AuditLog_organizationId_createdAt_idx" ON "AuditLog"("organizationId", "createdAt");
