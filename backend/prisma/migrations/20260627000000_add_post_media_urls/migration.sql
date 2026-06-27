-- Add mediaUrls column to Post table for storing attached media URLs
ALTER TABLE "Post" ADD COLUMN "mediaUrls" TEXT[] NOT NULL DEFAULT '{}';
