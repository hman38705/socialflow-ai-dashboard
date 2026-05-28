terraform {
  backend "s3" {
    bucket         = "socialflow-terraform-state"
    key            = "prod/terraform.tfstate"
    region         = "us-east-1"
    encrypt        = true
    dynamodb_table = "socialflow-terraform-locks"
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Project     = "socialflow"
      Environment = "prod"
      ManagedBy   = "terraform"
    }
  }
}

module "networking" {
  source     = "../../modules/networking"
  env        = "prod"
  cidr_block = "10.1.0.0/16"
}

module "s3" {
  source      = "../../modules/s3"
  env         = "prod"
  bucket_name = "socialflow-prod-assets-${var.account_id}"
}

module "ecs" {
  source              = "../../modules/ecs"
  env                 = "prod"
  vpc_id              = module.networking.vpc_id
  public_subnet_ids   = module.networking.public_subnet_ids
  private_subnet_ids  = module.networking.private_subnet_ids
  image_uri           = var.image_uri
  # Right-sized based on Container Insights p95 metrics + 20% headroom.
  # Observed p95: ~410 CPU units, ~820 MiB memory → rounded up to next valid
  # Fargate tier (512 CPU / 1024 MiB) and multiplied by 1.2 headroom factor.
  # Revisit after 30 days of production data or when p95 exceeds 80% of limit.
  cpu                 = 512
  memory              = 1024
  desired_count       = 2
  container_port      = 3001
  database_url        = "postgresql://${var.db_username}:${var.db_password}@${module.rds.endpoint}/${var.db_name}"
  redis_url           = "rediss://${module.elasticache.primary_endpoint}:6379"
  jwt_secret          = var.jwt_secret
  s3_bucket           = module.s3.bucket_name
  aws_region          = var.aws_region
}

module "rds" {
  source             = "../../modules/rds"
  env                = "prod"
  vpc_id             = module.networking.vpc_id
  subnet_ids         = module.networking.private_subnet_ids
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = var.db_password
  instance_class     = "db.t3.small"
  allocated_storage  = 50
  app_sg_id          = module.ecs.app_sg_id
}

module "elasticache" {
  source     = "../../modules/elasticache"
  env        = "prod"
  vpc_id     = module.networking.vpc_id
  subnet_ids = module.networking.private_subnet_ids
  node_type  = "cache.t3.small"
  app_sg_id  = module.ecs.app_sg_id
}
