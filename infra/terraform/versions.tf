terraform {
  required_version = ">= 1.10, < 2.0"

  backend "s3" {
    key          = "blooms-taxonomy/demo/terraform.tfstate"
    encrypt      = true
    use_lockfile = true
  }

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Application = var.project_name
      Environment = var.environment
      ManagedBy   = "Terraform"
      Repository  = "s-chall/mcq-generation-blooms-taxonomy"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ecr_repository" "api" {
  name = "${var.project_name}-api"
}

data "aws_ecr_repository" "web" {
  name = "${var.project_name}-web"
}

data "aws_ecr_repository" "worker" {
  name = "${var.project_name}-worker"
}

data "aws_ecr_repository" "migrate" {
  name = "${var.project_name}-migrate"
}
