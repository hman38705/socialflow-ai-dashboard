resource "aws_db_subnet_group" "main" {
  name       = "socialflow-${var.env}-db-subnet"
  subnet_ids = var.subnet_ids
  tags       = { Name = "socialflow-${var.env}-db-subnet" }
}

resource "aws_security_group" "rds" {
  name   = "socialflow-${var.env}-rds-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [var.app_sg_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "socialflow-${var.env}-rds-sg" }
}

resource "aws_db_parameter_group" "main" {
  name   = "socialflow-${var.env}-params"
  family = "postgres15"

  parameter {
    name  = "shared_buffers"
    value = "{DBInstanceClassMemory/4}"
  }

  parameter {
    name  = "work_mem"
    value = "4096"
  }

  parameter {
    name  = "max_connections"
    value = "200"
  }

  tags = { Name = "socialflow-${var.env}-params" }
}

resource "aws_db_instance" "main" {
  identifier             = "socialflow-${var.env}"
  engine                 = "postgres"
  engine_version         = "15"
  instance_class         = var.instance_class
  allocated_storage      = var.allocated_storage
  storage_encrypted      = true
  db_name                = var.db_name
  username               = var.db_username
  password               = var.db_password
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  parameter_group_name   = aws_db_parameter_group.main.name
  skip_final_snapshot    = var.env == "dev"
  deletion_protection    = var.env == "prod"
  multi_az               = true
  backup_retention_period = var.backup_retention_days
  tags                   = { Env = var.env }
}
