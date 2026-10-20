terraform {
  required_version = ">= 1.9"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.80"
    }
  }
  # State lives in S3 in ap-south-1 (created once by infra/terraform/bootstrap).
  backend "s3" {
    bucket         = "tableui-tfstate-dev"
    key            = "dev/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "tableui-tflock"
    encrypt        = true
  }
}

provider "aws" {
  region = var.region # NFR12: all dev resources stay in ap-south-1 (Mumbai)
  default_tags {
    tags = {
      project     = "table-to-ui"
      environment = "dev"
      managed_by  = "terraform"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  name = "tableui-dev"
  azs  = slice(data.aws_availability_zones.available.names, 0, 3)
}

# ---------------------------------------------------------------- network
module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.16"

  name = local.name
  cidr = "10.20.0.0/16"
  azs  = local.azs

  private_subnets  = ["10.20.1.0/24", "10.20.2.0/24", "10.20.3.0/24"]
  public_subnets   = ["10.20.101.0/24", "10.20.102.0/24", "10.20.103.0/24"]
  database_subnets = ["10.20.201.0/24", "10.20.202.0/24", "10.20.203.0/24"]

  enable_nat_gateway           = true
  single_nat_gateway           = true # dev: one NAT is enough
  create_database_subnet_group = true

  public_subnet_tags  = { "kubernetes.io/role/elb" = 1 }
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = 1, "karpenter.sh/discovery" = local.name }
}

# ---------------------------------------------------------------- kubernetes
module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.31"

  cluster_name    = local.name
  cluster_version = "1.31"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  cluster_endpoint_public_access           = true
  enable_cluster_creator_admin_permissions = true

  eks_managed_node_groups = {
    system = {
      instance_types = ["t3.medium"]
      min_size       = 2
      max_size       = 3
      desired_size   = 2
    }
  }

  node_security_group_tags = { "karpenter.sh/discovery" = local.name }
}

# ---------------------------------------------------------------- databases
resource "aws_security_group" "data" {
  name_prefix = "${local.name}-data-"
  vpc_id      = module.vpc.vpc_id

  ingress {
    description     = "PostgreSQL from the cluster"
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
  ingress {
    description     = "Valkey from the cluster"
    from_port       = 6379
    to_port         = 6379
    protocol        = "tcp"
    security_groups = [module.eks.node_security_group_id]
  }
}

resource "aws_kms_key" "data" {
  description         = "${local.name} data at rest"
  enable_key_rotation = true
}

resource "aws_db_parameter_group" "pg16" {
  name_prefix = "${local.name}-pg16-"
  family      = "postgres16"
  parameter {
    name         = "rds.force_ssl"
    value        = "1"
    apply_method = "immediate"
  }
}

# The primary database: control plane plus one schema per tenant.
resource "aws_db_instance" "primary" {
  identifier                          = "${local.name}-primary"
  engine                              = "postgres"
  engine_version                      = "16"
  instance_class                      = "db.t4g.medium"
  allocated_storage                   = 50
  max_allocated_storage               = 200
  db_name                             = "tableui"
  username                            = "tableui_admin"
  manage_master_user_password         = true # stored in Secrets Manager; no password in code or state
  storage_encrypted                   = true
  kms_key_id                          = aws_kms_key.data.arn
  db_subnet_group_name                = module.vpc.database_subnet_group_name
  vpc_security_group_ids              = [aws_security_group.data.id]
  parameter_group_name                = aws_db_parameter_group.pg16.name
  backup_retention_period             = 7
  deletion_protection                 = true
  skip_final_snapshot                 = false
  final_snapshot_identifier           = "${local.name}-primary-final"
  performance_insights_enabled        = true
  iam_database_authentication_enabled = true
}

# The analytics store is a second, separate database (PRD: measures never read live tables).
resource "aws_db_instance" "analytics" {
  identifier                  = "${local.name}-analytics"
  engine                      = "postgres"
  engine_version              = "16"
  instance_class              = "db.t4g.small"
  allocated_storage           = 20
  max_allocated_storage       = 100
  db_name                     = "tableui_analytics"
  username                    = "tableui_admin"
  manage_master_user_password = true
  storage_encrypted           = true
  kms_key_id                  = aws_kms_key.data.arn
  db_subnet_group_name        = module.vpc.database_subnet_group_name
  vpc_security_group_ids      = [aws_security_group.data.id]
  parameter_group_name        = aws_db_parameter_group.pg16.name
  backup_retention_period     = 7
  deletion_protection         = true
  skip_final_snapshot         = false
  final_snapshot_identifier   = "${local.name}-analytics-final"
}

resource "aws_elasticache_subnet_group" "valkey" {
  name       = "${local.name}-valkey"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "valkey" {
  replication_group_id       = "${local.name}-valkey"
  description                = "Cache and rate limits"
  engine                     = "valkey"
  engine_version             = "8.0"
  node_type                  = "cache.t4g.small"
  num_cache_clusters         = 1
  subnet_group_name          = aws_elasticache_subnet_group.valkey.name
  security_group_ids         = [aws_security_group.data.id]
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  kms_key_id                 = aws_kms_key.data.arn
}

# ---------------------------------------------------------------- storage and queues
resource "aws_s3_bucket" "files" {
  bucket_prefix = "${local.name}-files-"
}

resource "aws_s3_bucket_public_access_block" "files" {
  bucket                  = aws_s3_bucket.files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "files" {
  bucket = aws_s3_bucket.files.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm     = "aws:kms"
      kms_master_key_id = aws_kms_key.data.arn
    }
  }
}

resource "aws_s3_bucket_versioning" "files" {
  bucket = aws_s3_bucket.files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_sqs_queue" "events_dlq" {
  name                      = "${local.name}-events-dlq"
  message_retention_seconds = 1209600
  kms_master_key_id         = aws_kms_key.data.arn
}

resource "aws_sqs_queue" "events" {
  name                       = "${local.name}-events"
  visibility_timeout_seconds = 60
  kms_master_key_id          = aws_kms_key.data.arn
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.events_dlq.arn
    maxReceiveCount     = 5
  })
}
