variable "aws_region"  { type = string; default = "us-east-1" }
variable "account_id"  { type = string }
variable "image_uri"   { type = string }
variable "db_name"     { type = string; default = "socialflow" }
variable "db_username" { type = string; default = "socialflow" }
variable "db_password" { type = string; sensitive = true }
variable "jwt_secret"  { type = string; sensitive = true }
variable "terraform_trusted_principals" {
  type        = list(string)
  description = "AWS principals trusted to assume the Terraform executor role for prod environment"
  default     = []
}
