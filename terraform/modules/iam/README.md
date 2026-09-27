# IAM Module

This module provisions the IAM roles and policies used by the application's
compute and service workloads. It creates the execution role assumed by the
application runtime and attaches the managed and inline policies that grant
access to the other resources provisioned by this repository (for example S3
buckets and RDS instances).

## Purpose

- Create an IAM role that application workloads can assume.
- Attach AWS managed policies and module-defined inline policies to that role.
- Expose the role name and ARN so other modules and environments can reference
  them (for example when wiring up an EC2 instance profile or a Lambda
  execution role).

## Resources Provisioned

| Resource | Description |
| --- | --- |
| `aws_iam_role` | The IAM role assumed by the application workloads. |
| `aws_iam_role_policy_attachment` | Attachments of AWS managed policies to the role. |
| `aws_iam_role_policy` | Inline policies defined by this module and attached to the role. |

## Requirements

| Name | Version |
| --- | --- |
| terraform | >= 1.0 |
| aws | >= 4.0 |

## Inputs

| Name | Description | Type | Required |
| --- | --- | --- | --- |
| `name` | Name to use for the IAM role and related resources. | `string` | yes |
| `tags` | A map of tags to apply to all resources created by this module. | `map(string)` | no |
| `managed_policy_arns` | List of ARNs of AWS managed policies to attach to the role. | `list(string)` | no |
| `assume_role_policy` | JSON-encoded assume role policy document for the IAM role. Defaults to allowing EC2 to assume the role. | `string` | no |

## Outputs

| Name | Description |
| --- | --- |
| `role_name` | The name of the IAM role created by this module. |
| `role_arn` | The ARN of the IAM role created by this module. |

## Usage

```hcl
module "iam" {
  source = "../modules/iam"

  name = "my-app"

  tags = {
    Environment = "dev"
    Project     = "my-app"
  }
}
```
