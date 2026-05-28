output "terraform_executor_role_arn" {
  description = "ARN of the Terraform executor role"
  value       = aws_iam_role.terraform_executor.arn
}

output "terraform_executor_role_name" {
  description = "Name of the Terraform executor role"
  value       = aws_iam_role.terraform_executor.name
}
