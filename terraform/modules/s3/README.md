# S3 Module

This module provisions an S3 bucket for application storage, along with
supporting resources such as server-side encryption, versioning, public
access blocking, and lifecycle rules.

## Purpose

Use this module to create a secure, private S3 bucket that can be consumed
by the `dev` and `prod` environments. It encapsulates the common bucket
configuration (encryption, versioning, access controls, and lifecycle
management) so environments only need to supply a bucket name and a few
optional settings.

## Resources Provisioned

- `aws_s3_bucket` — the S3 bucket itself.
- `aws_s3_bucket_server_side_encryption_configuration` — default SSE
  encryption for the bucket.
- `aws_s3_bucket_versioning` — versioning configuration for the bucket.
- `aws_s3_bucket_public_access_block` — blocks all forms of public access.
- `aws_s3_bucket_lifecycle_configuration` — optional lifecycle rules for
  object expiration and noncurrent version cleanup.

## Inputs

| Name | Description | Type | Required |
|------|-------------|------|----------|
| `bucket_name` | Name of the S3 bucket to create. | `string` | yes |
| `environment` | Environment name (e.g. `dev`, `prod`) used for tagging. | `string` | yes |
| `versioning_enabled` | Whether to enable versioning on the bucket. | `bool` | no |
| `lifecycle_expiration_days` | Number of days after which objects expire. Set to `0` to disable the lifecycle rule. | `number` | no |
| `tags` | Additional tags to apply to the bucket and its resources. | `map(string)` | no |

## Outputs

| Name | Description |
|------|-------------|
| `bucket_id` | The name (ID) of the created S3 bucket. |
| `bucket_arn` | The ARN of the created S3 bucket. |
| `bucket_domain_name` | The bucket domain name (e.g. `bucket.s3.amazonaws.com`). |

## Usage

```hcl
module "s3" {
  source = "../../modules/s3"

  bucket_name             = "my-app-${var.environment}-storage"
  environment             = var.environment
  versioning_enabled      = true
  lifecycle_expiration_days = 30

  tags = {
    Project = "my-app"
  }
}
```
