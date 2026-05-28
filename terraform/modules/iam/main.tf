resource "aws_iam_role" "terraform_executor" {
  name = "socialflow-terraform-${var.env}-executor"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          AWS = var.trusted_principals
        }
      }
    ]
  })

  tags = {
    Environment = var.env
    Purpose     = "Terraform State Access"
  }
}

resource "aws_iam_role_policy" "terraform_state_access" {
  name = "socialflow-terraform-${var.env}-state-access"
  role = aws_iam_role.terraform_executor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3StateAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject"
        ]
        Resource = "arn:aws:s3:::socialflow-terraform-state/env/${var.env}/*"
      },
      {
        Sid    = "S3ListBucket"
        Effect = "Allow"
        Action = [
          "s3:ListBucket"
        ]
        Resource = "arn:aws:s3:::socialflow-terraform-state"
        Condition = {
          StringLike = {
            "s3:prefix" = "env/${var.env}/*"
          }
        }
      },
      {
        Sid    = "DynamoDBLockAccess"
        Effect = "Allow"
        Action = [
          "dynamodb:DescribeTable",
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:DeleteItem"
        ]
        Resource = "arn:aws:dynamodb:*:*:table/socialflow-terraform-locks"
        Condition = {
          StringEquals = {
            "dynamodb:LeadingKeys" = ["env/${var.env}"]
          }
        }
      }
    ]
  })
}

resource "aws_iam_role_policy" "terraform_infrastructure_access" {
  name = "socialflow-terraform-${var.env}-infrastructure-access"
  role = aws_iam_role.terraform_executor.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "EC2Access"
        Effect = "Allow"
        Action = [
          "ec2:*"
        ]
        Resource = "*"
        Condition = {
          StringEquals = {
            "aws:RequestedRegion" = var.aws_region
          }
        }
      },
      {
        Sid    = "RDSAccess"
        Effect = "Allow"
        Action = [
          "rds:*"
        ]
        Resource = "*"
        Condition = {
          StringLike = {
            "aws:SourceArn" = "arn:aws:rds:*:*:db/socialflow-${var.env}-*"
          }
        }
      },
      {
        Sid    = "ElastiCacheAccess"
        Effect = "Allow"
        Action = [
          "elasticache:*"
        ]
        Resource = "*"
        Condition = {
          StringLike = {
            "aws:SourceArn" = "arn:aws:elasticache:*:*:cluster:socialflow-${var.env}-*"
          }
        }
      },
      {
        Sid    = "ECSAccess"
        Effect = "Allow"
        Action = [
          "ecs:*",
          "ecr:*"
        ]
        Resource = "*"
        Condition = {
          StringLike = {
            "aws:SourceArn" = "arn:aws:ecs:*:*:cluster/socialflow-${var.env}-*"
          }
        }
      },
      {
        Sid    = "IAMRoleAccess"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:PassRole"
        ]
        Resource = "arn:aws:iam::*:role/socialflow-${var.env}-*"
      }
    ]
  })
}
