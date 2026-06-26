terraform {
  backend "s3" {
    bucket         = "socialflow-terraform-state"
    key            = "env/dev/terraform.tfstate"
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
      Environment = "dev"
      ManagedBy   = "terraform"
    }
  }
}

module "networking" {
  source     = "../../modules/networking"
  env        = "dev"
  cidr_block = "10.0.0.0/16"
}

module "s3" {
  source      = "../../modules/s3"
  env         = "dev"
  bucket_name = "socialflow-dev-assets-${var.account_id}"
}

module "ecs" {
  source              = "../../modules/ecs"
  env                 = "dev"
  vpc_id              = module.networking.vpc_id
  public_subnet_ids   = module.networking.public_subnet_ids
  private_subnet_ids  = module.networking.private_subnet_ids
  image_uri           = var.image_uri
  cpu                 = 256
  memory              = 512
  desired_count       = 1
  container_port      = 3001
  database_url        = "postgresql://${var.db_username}:${var.db_password}@${module.rds.endpoint}/${var.db_name}"
  redis_url           = "rediss://${module.elasticache.primary_endpoint}:6379"
  jwt_secret          = var.jwt_secret
  s3_bucket           = module.s3.bucket_name
  aws_region          = var.aws_region
}

module "rds" {
  source             = "../../modules/rds"
  env                = "dev"
  vpc_id             = module.networking.vpc_id
  subnet_ids         = module.networking.private_subnet_ids
  db_name            = var.db_name
  db_username        = var.db_username
  db_password        = var.db_password
  instance_class     = "db.t3.micro"
  allocated_storage  = 20
  app_sg_id          = module.ecs.app_sg_id
}

module "elasticache" {
  source     = "../../modules/elasticache"
  env        = "dev"
  vpc_id     = module.networking.vpc_id
  subnet_ids = module.networking.private_subnet_ids
  node_type  = "cache.t3.micro"
  app_sg_id  = module.ecs.app_sg_id
}

module "iam" {
  source             = "../../modules/iam"
  env                = "dev"
  aws_region         = var.aws_region
  trusted_principals = var.terraform_trusted_principals
}
