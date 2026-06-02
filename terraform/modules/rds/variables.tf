variable "env"               { type = string }
variable "vpc_id"            { type = string }
variable "subnet_ids"        { type = list(string) }
variable "db_name"           { type = string }
variable "db_username"       { type = string }
variable "db_password"       { type = string; sensitive = true }
variable "instance_class"    { type = string; default = "db.t3.micro" }
variable "allocated_storage" { type = number; default = 20 }
variable "app_sg_id"         { type = string }

# Number of days to retain automated RDS backups.
# Default: 7 (production-safe). Override to 1 for dev/staging or 0 to disable (not recommended).
variable "backup_retention_days" {
  type        = number
  default     = 7
  description = "Backup retention period in days. Set to 0 to disable (AWS default). Minimum 7 recommended for production."
}

variable "enable_deletion_protection" {
  type        = bool
  default     = true
  description = "Prevents the RDS instance from being accidentally deleted. Set to false only for dev/test environments that need terraform destroy."
}
