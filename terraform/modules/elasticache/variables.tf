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

variable "cluster_id" {
  description = "Identifier for the ElastiCache cluster"
  type        = string
}

variable "node_type" {
  description = "ElastiCache node instance type"
  type        = string
}

variable "num_cache_nodes" {
  description = "Number of cache nodes in the ElastiCache cluster"
  type        = number
}
