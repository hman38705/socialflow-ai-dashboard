variable "env" {
  description = "Environment name (dev or prod)"
  type        = string
  validation {
    condition     = contains(["dev", "prod"], var.env)
    error_message = "Environment must be either 'dev' or 'prod'."
  }
}

variable "aws_region" {
  description = "AWS region"
  type        = string
}

variable "project_name" {
  description = "Project name used as a prefix for ECS resource names"
  type        = string
}

variable "vpc_id" {
  description = "ID of the VPC where the ECS cluster and services are deployed"
  type        = string
}

variable "private_subnet_ids" {
  description = "List of private subnet IDs used by the ECS services"
  type        = list(string)
}

variable "public_subnet_ids" {
  description = "List of public subnet IDs used by internet-facing load balancers"
  type        = list(string)
}

variable "cluster_name" {
  description = "Name of the ECS cluster"
  type        = string
}

variable "service_name" {
  description = "Name of the ECS service"
  type        = string
}

variable "task_family" {
  description = "Family name for the ECS task definition"
  type        = string
}

variable "container_name" {
  description = "Name of the container within the ECS task definition"
  type        = string
}

variable "container_image" {
  description = "Docker image (including tag) used for the container"
  type        = string
}

variable "container_port" {
  description = "Port the container listens on"
  type        = number
}

variable "cpu" {
  description = "CPU units reserved for the task (e.g. 256, 512, 1024)"
  type        = number
}

variable "memory" {
  description = "Memory in MiB reserved for the task (e.g. 512, 1024, 2048)"
  type        = number
}

variable "desired_count" {
  description = "Number of task instances to run for the ECS service"
  type        = number
}

variable "launch_type" {
  description = "ECS launch type for the service (FARGATE or EC2)"
  type        = string
}

variable "assign_public_ip" {
  description = "Whether to assign a public IP to tasks (required for Fargate in public subnets)"
  type        = bool
}

variable "execution_role_arn" {
  description = "ARN of the IAM role used by the ECS agent to pull images and write logs"
  type        = string
}

variable "task_role_arn" {
  description = "ARN of the IAM role assumed by the application running in the container"
  type        = string
}

variable "log_retention_days" {
  description = "Number of days to retain CloudWatch logs for the service"
  type        = number
}

variable "health_check_path" {
  description = "HTTP path used by the load balancer target group health check"
  type        = string
}

variable "environment_variables" {
  description = "Map of environment variables passed to the container"
  type        = map(string)
}

variable "tags" {
  description = "Map of tags applied to all ECS resources"
  type        = map(string)
}
