# ECS Module

This module provisions an AWS ECS (Elastic Container Service) cluster and the
supporting resources needed to run containerized workloads on Fargate. It is
consumed by the environment stacks under `terraform/environments/{dev,prod}`.

## Purpose

Given a project name, environment, region, and a set of container definitions,
the module creates:

- An ECS cluster (with Container Insights enabled).
- CloudWatch log groups for each container definition.
- IAM roles and policies for task execution and task runtime.
- Task definitions for each container definition.
- An ECS service (Fargate launch type) with the desired task count.
- Security groups allowing the service to reach the network.

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.0 |
| aws | >= 4.0 |

## Inputs

| Name | Description | Type | Required |
|------|-------------|------|----------|
| `project` | Name of the project, used as a prefix for created resources. | `string` | yes |
| `environment` | Deployment environment (e.g. `dev`, `prod`). | `string` | yes |
| `region` | AWS region to deploy into. | `string` | yes |
| `vpc_id` | VPC ID where the ECS service and security groups are created. | `string` | yes |
| `subnet_ids` | Subnet IDs used by the ECS service. | `list(string)` | yes |
| `container_definitions` | List of container definitions to register as task definitions. | `list(object({ name = string, image = string, cpu = number, memory = number, port = number, environment = map(string) }))` | yes |
| `desired_count` | Desired number of running tasks for the ECS service. | `number` | no (default `1`) |
| `cpu` | CPU units for the task definition. | `number` | no (default `256`) |
| `memory` | Memory (MiB) for the task definition. | `number` | no (default `512`) |
| `tags` | Additional tags applied to all created resources. | `map(string)` | no (default `{}`) |

## Outputs

| Name | Description |
|------|-------------|
| `cluster_id` | ID of the created ECS cluster. |
| `cluster_arn` | ARN of the created ECS cluster. |
| `cluster_name` | Name of the created ECS cluster. |
| `service_name` | Name of the created ECS service. |
| `task_definition_arns` | Map of container name to task definition ARN. |
| `security_group_id` | ID of the security group attached to the ECS service. |

## Usage

```hcl
module "ecs" {
  source = "../../modules/ecs"

  project     = "my-app"
  environment = "dev"
  region      = "us-east-1"
  vpc_id      = module.network.vpc_id
  subnet_ids  = module.network.private_subnet_ids

  container_definitions = [
    {
      name        = "api"
      image       = "nginx:latest"
      cpu         = 256
      memory      = 512
      port        = 8080
      environment = { LOG_LEVEL = "info" }
    }
  ]
}
```
