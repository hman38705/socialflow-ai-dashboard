resource "aws_s3_bucket" "main" {
  bucket        = var.bucket_name
  force_destroy = var.env == "dev"
  tags          = { Env = var.env }
}

resource "aws_s3_bucket_versioning" "main" {
  bucket = aws_s3_bucket.main.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "main" {
  bucket = aws_s3_bucket.main.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "main" {
  bucket                  = aws_s3_bucket.main.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "main" {
  bucket = aws_s3_bucket.main.id

  rule {
    id     = "expire-old-uploads"
    status = "Enabled"
    filter { prefix = "uploads/" }
    expiration { days = var.env == "prod" ? 365 : 30 }
  }

  rule {
    id     = "backup-retention"
    status = "Enabled"
    filter { prefix = "backups/" }

    # Remove current backup objects after 30 days
    expiration { days = 30 }

    # Remove non-current versions (after versioning overwrites) after 7 days
    noncurrent_version_expiration { noncurrent_days = 7 }

    # Clean up incomplete multipart uploads after 1 day
    abort_incomplete_multipart_upload { days_after_initiation = 1 }
  }
}
