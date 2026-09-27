# Networking Module

This module provisions the core AWS networking layer used by the
`terraform/environments/{dev,prod}` stacks: a VPC with public and private
subnets spread across multiple availability zones, an internet gateway for
public egress, NAT gateways for private egress, and the route tables that wire
them together.

## Purpose

Create an isolated, multi-AZ network foundation that other modules (compute,
databases, load balancers) can attach to. Public subnets are intended for
internet-facing resources, while private subnets are intended for workloads
that should only reach the internet through NAT.

## Resources Provisioned

- `aws_vpc` — the VPC for the environment.
- `aws_subnet` — public and private subnets, one per availability zone.
- `aws_internet_gateway` — attached to the VPC for public subnet egress.
- `aws_eip` — elastic IPs allocated for the NAT gateways.
- `aws_nat_gateway` — one NAT gateway per public subnet for private egress.
- `aws_route_table` / `aws_route` — public and private route tables.
- `aws_route_table_association` — associates each subnet with its route table.

## Inputs

| Name | Description | Type | Required |
| --- | --- | --- | --- |
| `name` | Name prefix applied to all networking resources. | `string` | yes |
| `vpc_cidr` | CIDR block for the VPC. | `string` | yes |
| `availability_zones` | Availability zones to spread subnets across. | `list(string)` | yes |
| `public_subnet_cidrs` | CIDR blocks for the public subnets. | `list(string)` | yes |
| `private_subnet_cidrs` | CIDR blocks for the private subnets. | `list(string)` | yes |
| `enable_nat_gateway` | Whether to provision NAT gateways for private subnets. | `bool` | no |
| `tags` | Tags applied to all resources created by the module. | `map(string)` | no |

## Outputs

| Name | Description |
| --- | --- |
| `vpc_id` | ID of the created VPC. |
| `vpc_cidr` | CIDR block of the created VPC. |
| `public_subnet_ids` | IDs of the public subnets. |
| `private_subnet_ids` | IDs of the private subnets. |
| `internet_gateway_id` | ID of the internet gateway. |
| `nat_gateway_ids` | IDs of the NAT gateways. |

## Usage

```hcl
module "networking" {
  source = "../../modules/networking"

  name                 = "my-app-dev"
  vpc_cidr             = "10.0.0.0/16"
  availability_zones   = ["us-east-1a", "us-east-1b"]
  public_subnet_cidrs  = ["10.0.1.0/24", "10.0.2.0/24"]
  private_subnet_cidrs = ["10.0.11.0/24", "10.0.12.0/24"]
  enable_nat_gateway   = true

  tags = {
    Environment = "dev"
  }
}
```
