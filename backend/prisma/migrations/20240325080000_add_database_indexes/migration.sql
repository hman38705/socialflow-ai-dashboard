-- Add indexes for User table
CREATE INDEX "User_email_idx" ON "User"("email");
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
CREATE INDEX "User_deletedAt_idx" ON "User"("deletedAt");

-- Add indexes for Organization table
CREATE INDEX "Organization_slug_idx" ON "Organization"("slug");
CREATE INDEX "Organization_createdAt_idx" ON "Organization"("createdAt");

-- Add indexes for OrganizationMember table
CREATE INDEX "OrganizationMember_organizationId_idx" ON "OrganizationMember"("organizationId");
CREATE INDEX "OrganizationMember_userId_idx" ON "OrganizationMember"("userId");
CREATE INDEX "OrganizationMember_joinedAt_idx" ON "OrganizationMember"("joinedAt");

-- Add indexes for Post table
CREATE INDEX "Post_organizationId_idx" ON "Post"("organizationId");
CREATE INDEX "Post_platform_idx" ON "Post"("platform");
CREATE INDEX "Post_createdAt_idx" ON "Post"("createdAt");
CREATE INDEX "Post_scheduledAt_idx" ON "Post"("scheduledAt");

-- Add indexes for AnalyticsEntry table
CREATE INDEX "AnalyticsEntry_organizationId_idx" ON "AnalyticsEntry"("organizationId");
CREATE INDEX "AnalyticsEntry_platform_idx" ON "AnalyticsEntry"("platform");
CREATE INDEX "AnalyticsEntry_metric_idx" ON "AnalyticsEntry"("metric");
CREATE INDEX "AnalyticsEntry_recordedAt_idx" ON "AnalyticsEntry"("recordedAt");

-- Add indexes for Listing table
CREATE INDEX "Listing_mentorId_idx" ON "Listing"("mentorId");
CREATE INDEX "Listing_isActive_idx" ON "Listing"("isActive");
CREATE INDEX "Listing_createdAt_idx" ON "Listing"("createdAt");
CREATE INDEX "Listing_deletedAt_idx" ON "Listing"("deletedAt");
