variable "env"              { type = string }
variable "vpc_id"           { type = string }
variable "public_subnet_ids"  { type = list(string) }
variable "private_subnet_ids" { type = list(string) }
variable "image_uri"        { type = string }

# CPU/memory right-sizing
# Values are set based on observed p95 usage plus 20% headroom from Container Insights metrics.
# Fargate valid CPU/memory combinations: https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task-cpu-memory-error.html
# Default (dev/staging): 256 CPU units (0.25 vCPU) / 512 MB — sufficient for low-traffic environments.
# Production overrides are set in terraform/environments/prod/main.tf.
variable "cpu"              {
  type        = number
  default     = 256
  description = "Fargate task CPU units (256, 512, 1024, 2048, 4096). Set based on p95 usage + 20% headroom."
}
variable "memory"           {
  type        = number
  default     = 512
  description = "Fargate task memory in MiB. Must be compatible with the chosen cpu value."
}

variable "desired_count"    { type = number; default = 1 }
variable "container_port"   { type = number; default = 3001 }
variable "database_url"     { type = string; sensitive = true }
variable "redis_url"        { type = string; sensitive = true }
variable "jwt_secret"       { type = string; sensitive = true }
variable "s3_bucket"        { type = string }
variable "aws_region"       { type = string }
