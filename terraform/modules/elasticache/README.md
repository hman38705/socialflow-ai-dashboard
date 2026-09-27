# ElastiCache Module

This module provisions an AWS ElastiCache Redis replication group (cluster) together with the
supporting networking and security resources required to make it reachable from the
application tier.

It is consumed by the environment stacks under `terraform/environments/{dev,prod}`.

## Purpose

- Create a managed Redis cluster for caching / session storage.
- Place the cluster in private subnets and restrict access to a caller-supplied set of
  security groups.
- Expose the connection endpoint and port so application services can be wired to it.

## Resources Provisioned

- `aws_elasticache_subnet_group` — subnet group built from the supplied private subnet IDs.
- `aws_security_group` — security group controlling access to the cluster.
- `aws_security_group_rule` — ingress rule allowing traffic from the allowed security groups.
- `aws_elasticache_replication_group` — the Redis replication group itself.

## Requirements

| Name | Version |
|------|---------|
| terraform | >= 1.0 |
| aws | >= 4.0 |

## Inputs

| Name | Description | Type | Required |
|------|-------------|------|----------|
| `name` | Name prefix used for the cluster and associated resources. | `string` | yes |
| `vpc_id` | VPC ID in which the cluster and security group are created. | `string` | yes |
| `subnet_ids` | List of private subnet IDs used for the ElastiCache subnet group. | `list(string)` | yes |
| `allowed_security_group_ids` | Security group IDs permitted to connect to the cluster. | `list(string)` | yes |
| `node_type` | ElastiCache node instance type. | `string` | no |
| `num_cache_nodes` | Number of cache nodes in the replication group. | `number` | no |
| `engine_version` | Redis engine version. | `string` | no |
| `parameter_group_name` | Name of the ElastiCache parameter group to use. | `string` | no |
| `port` | Port the cluster listens on. | `number` | no |
| `automatic_failover_enabled` | Whether automatic failover is enabled. | `bool` | no |
| `at_rest_encryption_enabled` | Whether encryption at rest is enabled. | `bool` | no |
| `transit_encryption_enabled` | Whether encryption in transit is enabled. | `bool` | no |
| `tags` | Map of tags applied to all resources. | `map(string)` | no |

## Outputs

| Name | Description |
|------|-------------|
| `endpoint` | Primary endpoint address of the Redis replication group. |
| `port` | Port the Redis replication group listens on. |
| `security_group_id` | ID of the security group attached to the cluster. |
| `replication_group_id` | ID of the ElastiCache replication group. |

## Usage

```hcl
module "elasticache" {
  source = "../../modules/elasticache"

  name                       = "app-cache"
  vpc_id                     = module.vpc.vpc_id
  subnet_ids                 = module.vpc.private_subnet_ids
  allowed_security_group_ids = [module.ecs.service_security_group_id]

  tags = local.common_tags
}
```
