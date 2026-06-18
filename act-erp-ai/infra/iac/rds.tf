resource "random_password" "db_master" {
  length  = 24
  special = false
}

# Password for the read-only RLS role the agent uses (act_rls). The role itself
# is created by the post-deploy SQL (prisma/sql/01_rag_pgvector_rls.sql) — set its
# password to this value (see infra/iac/README.md).
resource "random_password" "rls" {
  length  = 24
  special = false
}

resource "aws_db_subnet_group" "main" {
  name       = "${var.name}-db"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "main" {
  identifier             = "${var.name}-pg"
  engine                 = "postgres"
  engine_version         = "16"
  instance_class         = var.db_instance_class
  allocated_storage      = 20
  max_allocated_storage  = 100
  db_name                = "act"
  username               = "actmaster"
  password               = random_password.db_master.result
  db_subnet_group_name   = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.rds.id]
  publicly_accessible    = false
  storage_encrypted      = true
  skip_final_snapshot    = true # set false + final_snapshot_identifier for real prod
  backup_retention_period = 7
  apply_immediately      = true
}

locals {
  db_host       = aws_db_instance.main.address
  database_url  = "postgresql://actmaster:${random_password.db_master.result}@${local.db_host}:5432/act"
  rls_database_url = "postgresql://act_rls:${random_password.rls.result}@${local.db_host}:5432/act"
}
