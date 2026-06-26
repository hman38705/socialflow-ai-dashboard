resource "aws_elasticache_subnet_group" "main" {
  name       = "socialflow-${var.env}-cache-subnet"
  subnet_ids = var.subnet_ids
}

resource "aws_security_group" "redis" {
  name   = "socialflow-${var.env}-redis-sg"
  vpc_id = var.vpc_id

  ingress {
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [var.app_sg_id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = { Name = "socialflow-${var.env}-redis-sg" }
}

resource "aws_elasticache_replication_group" "main" {
  replication_group_id = "socialflow-${var.env}"
  description          = "SocialFlow Redis ${var.env}"
  node_type            = var.node_type
  num_cache_clusters   = var.env == "prod" ? 2 : 1
  port                 = 6379
  subnet_group_name    = aws_elasticache_subnet_group.main.name
  security_group_ids   = [aws_security_group.redis.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  automatic_failover_enabled = var.env == "prod" ? true : false
  tags                       = { Env = var.env }
}
