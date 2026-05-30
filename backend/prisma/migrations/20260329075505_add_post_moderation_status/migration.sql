-- Add moderationStatus field to Post with default 'pending'
ALTER TABLE "Post" ADD COLUMN "moderationStatus" TEXT NOT NULL DEFAULT 'pending';
CREATE INDEX "Post_moderationStatus_idx" ON "Post"("moderationStatus");
