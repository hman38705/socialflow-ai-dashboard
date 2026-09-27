# RDS Module

This module provisions a managed PostgreSQL database on AWS RDS, along with the
supporting networking and security resources needed to make it reachable from
within a VPC.

## Purpose

Use this module to stand up a single RDS PostgreSQL instance for an environment
(e.g. `terraform/environments/dev` or `terraform/environments/prod`). It creates
the database subnet group, the security group that controls access, and the
RDS instance itself, and exposes the connection details as outputs.

## Resources Provisioned

- `aws_db_subnet_group` — groups the private subnets the database can be placed in.
- `aws_security_group` — controls network access to the database.
- `aws_db_instance` — the PostgreSQL RDS instance.

## Inputs

| Name | Description | Type | Required |
|------|-------------|------|----------|
| `identifier` | Unique identifier for the RDS instance. | `string` | yes |
| `engine_version` | PostgreSQL engine version to run. | `string` | no |
| `instance_class` | RDS instance class (e.g. `db.t3.micro`). | `string` | no |
| `allocated_storage` | Allocated storage for the database, in GiB. | `number` | no |
| `db_name` | Name of the initial database to create. | `string` | no |
| `username` | Master username for the database. | `string` | yes |
| `password` | Master password for the database. | `string` | yes |
| `subnet_ids` | Subnet IDs used for the database subnet group. | `list(string)` | yes |
| `vpc_id` | VPC ID the security group is created in. | `string` | yes |
| `allowed_cidr_blocks` | CIDR blocks allowed to connect to the database. | `list(string)` | no |
| `multi_az` | Whether to deploy the instance across multiple AZs. | `bool` | no |
| `backup_retention_period` | Number of days to retain automated backups. | `number` | no |
| `skip_final_snapshot` | Whether to skip the final snapshot on destroy. | `bool` | no |
| `tags` | Tags to apply to the created resources. | `map(string)` | no |

## Outputs

| Name | Description |
|------|-------------|
| `db_instance_id` | Identifier of the RDS instance. |
| `db_instance_arn` | ARN of the RDS instance. |
| `db_instance_endpoint` | Connection endpoint (`host:port`) of the RDS instance. |
| `db_instance_address` | Hostname of the RDS instance. |
| `db_instance_port` | Port the RDS instance listens on. |
| `db_name` | Name of the initial database. |
| `security_group_id` | ID of the security group controlling access to the database. |

## Usage

```hcl
module "rds" {
  source = "../../modules/rds"

  identifier     = "my-app-db"
  username       = var.db_username
  password       = var.db_password
  subnet_ids     = module.networking.private_subnet_ids
  vpc_id         = module.networking.vpc_id
  instance_class = "db.t3.micro"

  tags = {
    Environment = var.environment
  }
}
```
