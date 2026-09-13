resource "aws_db_subnet_group" "database" {
  name       = "${local.name}-database"
  subnet_ids = aws_subnet.database[*].id
}

resource "aws_db_parameter_group" "database" {
  name_prefix = "${local.name}-postgres17-"
  family      = "postgres17"

  parameter {
    name  = "rds.force_ssl"
    value = "1"
  }

  lifecycle { create_before_destroy = true }
}

resource "aws_db_instance" "database" {
  identifier = local.name

  engine                      = "postgres"
  engine_version              = "17.6"
  instance_class              = var.database_instance_class
  allocated_storage           = 20
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = local.database_name
  username                    = local.database_user
  manage_master_user_password = true
  port                        = 5432

  db_subnet_group_name   = aws_db_subnet_group.database.name
  parameter_group_name   = aws_db_parameter_group.database.name
  vpc_security_group_ids = [aws_security_group.database.id]
  publicly_accessible    = false
  multi_az               = false

  backup_retention_period    = 7
  auto_minor_version_upgrade = true
  deletion_protection        = var.database_deletion_protection
  skip_final_snapshot        = var.environment == "demo"
  final_snapshot_identifier  = var.environment == "demo" ? null : "${local.name}-final"

  apply_immediately = true
}
