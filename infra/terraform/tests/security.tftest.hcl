mock_provider "aws" {
  mock_data "aws_availability_zones" {
    defaults = {
      names = ["us-east-1a", "us-east-1b"]
    }
  }

  mock_data "aws_ecr_repository" {
    defaults = {
      repository_url = "123456789012.dkr.ecr.us-east-1.amazonaws.com/mock"
    }
  }

  mock_data "aws_iam_policy_document" {
    defaults = {
      json = "{\"Version\":\"2012-10-17\",\"Statement\":[]}"
    }
  }

  mock_resource "aws_db_instance" {
    defaults = {
      address = "database.internal"
      port    = 5432
      master_user_secret = [{
        kms_key_id    = "mock-key"
        secret_arn    = "arn:aws:secretsmanager:us-east-1:123456789012:secret:database"
        secret_status = "active"
      }]
    }
  }

  mock_resource "aws_iam_role" {
    defaults = {
      arn  = "arn:aws:iam::123456789012:role/blooms-taxonomy-mock"
      id   = "blooms-taxonomy-mock"
      name = "blooms-taxonomy-mock"
    }
  }

  mock_resource "aws_ecs_cluster" {
    defaults = {
      arn  = "arn:aws:ecs:us-east-1:123456789012:cluster/blooms-taxonomy-mock"
      id   = "arn:aws:ecs:us-east-1:123456789012:cluster/blooms-taxonomy-mock"
      name = "blooms-taxonomy-mock"
    }
  }

  mock_resource "aws_ecs_task_definition" {
    defaults = {
      arn = "arn:aws:ecs:us-east-1:123456789012:task-definition/blooms-taxonomy-mock:1"
    }
  }

  mock_resource "aws_lb" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/blooms-taxonomy-mock/0123456789abcdef"
      arn_suffix = "app/blooms-taxonomy-mock/0123456789abcdef"
      dns_name   = "blooms-taxonomy-mock.us-east-1.elb.amazonaws.com"
    }
  }

  mock_resource "aws_lb_target_group" {
    defaults = {
      arn        = "arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/blooms-mock/0123456789abcdef"
      arn_suffix = "targetgroup/blooms-mock/0123456789abcdef"
    }
  }
}

run "secure_and_inactive_defaults" {
  command = apply

  assert {
    condition     = aws_db_instance.database.publicly_accessible == false
    error_message = "PostgreSQL must not be publicly reachable."
  }

  assert {
    condition     = aws_db_instance.database.storage_encrypted == true
    error_message = "RDS storage encryption must remain enabled."
  }

  assert {
    condition     = aws_db_instance.database.manage_master_user_password == true
    error_message = "RDS credentials must remain managed by Secrets Manager."
  }

  assert {
    condition     = aws_sqs_queue.generation.sqs_managed_sse_enabled == true && aws_sqs_queue.dead_letter.sqs_managed_sse_enabled == true
    error_message = "Both queues must use server-side encryption."
  }

  assert {
    condition     = jsondecode(aws_sqs_queue.generation.redrive_policy).maxReceiveCount == 5
    error_message = "The generation queue must redrive poison messages after bounded retries."
  }

  assert {
    condition     = aws_ecs_service.application.desired_count == 0 && aws_ecs_service.worker.desired_count == 0 && aws_ecs_service.publisher.desired_count == 0
    error_message = "A plain Terraform apply must not start tasks before migrations."
  }

  assert {
    condition     = aws_lb.application.drop_invalid_header_fields == true
    error_message = "The public load balancer must reject invalid HTTP headers."
  }

  assert {
    condition     = aws_lb_target_group.application.health_check[0].path == "/api/health/ready"
    error_message = "Load balancer health must verify the portal-to-API-to-database path."
  }
}
