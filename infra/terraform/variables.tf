variable "aws_region" {
  description = "AWS Region for the deployment."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Stable prefix for AWS resources and bootstrap ECR repositories."
  type        = string
  default     = "blooms-taxonomy"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{2,30}$", var.project_name))
    error_message = "project_name must be a lowercase DNS-style name between 3 and 31 characters."
  }
}

variable "environment" {
  description = "Deployment environment name."
  type        = string
  default     = "demo"

  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,10}$", var.environment))
    error_message = "environment must be a lowercase DNS-style name between 2 and 11 characters."
  }
}

variable "image_tag" {
  description = "Immutable container image tag, normally the Git commit SHA."
  type        = string
  default     = "latest"
}

variable "application_desired_count" {
  description = "Number of load-balanced web/API tasks. Keep zero until migrations succeed."
  type        = number
  default     = 0

  validation {
    condition     = var.application_desired_count >= 0 && var.application_desired_count <= 4
    error_message = "application_desired_count must be between 0 and 4."
  }
}

variable "worker_desired_count" {
  description = "Number of generation workers and outbox publishers."
  type        = number
  default     = 0

  validation {
    condition     = var.worker_desired_count >= 0 && var.worker_desired_count <= 4
    error_message = "worker_desired_count must be between 0 and 4."
  }
}

variable "database_instance_class" {
  description = "RDS instance class; the default is suitable only for a low-traffic demo."
  type        = string
  default     = "db.t4g.micro"
}

variable "database_deletion_protection" {
  description = "Protect the RDS instance from deletion. Enable outside disposable demos."
  type        = bool
  default     = false
}

variable "allowed_ingress_cidrs" {
  description = "IPv4 networks allowed to reach the public Application Load Balancer."
  type        = list(string)
  default     = ["0.0.0.0/0"]
}

locals {
  name          = "${var.project_name}-${var.environment}"
  database_name = "blooms"
  database_user = "blooms_admin"
  common_environment = [
    { name = "PGHOST", value = aws_db_instance.database.address },
    { name = "PGPORT", value = tostring(aws_db_instance.database.port) },
    { name = "PGDATABASE", value = local.database_name },
    { name = "PGSSLMODE", value = "require" },
  ]
  database_secrets = [
    {
      name      = "PGUSER"
      valueFrom = "${aws_db_instance.database.master_user_secret[0].secret_arn}:username::"
    },
    {
      name      = "PGPASSWORD"
      valueFrom = "${aws_db_instance.database.master_user_secret[0].secret_arn}:password::"
    },
  ]
}
