resource "aws_ecs_cluster" "main" {
  name = local.name

  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/ecs/${local.name}/api"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/ecs/${local.name}/web"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "publisher" {
  name              = "/ecs/${local.name}/publisher"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "worker" {
  name              = "/ecs/${local.name}/worker"
  retention_in_days = 14
}

resource "aws_cloudwatch_log_group" "migration" {
  name              = "/ecs/${local.name}/migration"
  retention_in_days = 14
}

locals {
  worker_environment = concat(local.common_environment, [
    { name = "AWS_REGION", value = var.aws_region },
    { name = "SQS_QUEUE_URL", value = aws_sqs_queue.generation.url },
  ])
}

resource "aws_ecs_task_definition" "application" {
  family                   = "${local.name}-application"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 512
  memory                   = 1024
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.api.arn

  runtime_platform {
    cpu_architecture        = "X86_64"
    operating_system_family = "LINUX"
  }

  container_definitions = jsonencode([
    {
      name      = "api"
      image     = "${data.aws_ecr_repository.api.repository_url}:${var.image_tag}"
      essential = true
      cpu       = 256
      memory    = 512
      portMappings = [{
        containerPort = 3000
        hostPort      = 3000
        protocol      = "tcp"
      }]
      environment = local.common_environment
      secrets     = local.database_secrets
      healthCheck = {
        command     = ["CMD-SHELL", "node --input-type=module --eval \"fetch('http://127.0.0.1:3000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\""]
        interval    = 15
        timeout     = 5
        retries     = 5
        startPeriod = 30
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.api.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "api"
        }
      }
    },
    {
      name      = "web"
      image     = "${data.aws_ecr_repository.web.repository_url}:${var.image_tag}"
      essential = true
      cpu       = 256
      memory    = 512
      portMappings = [{
        containerPort = 8080
        hostPort      = 8080
        protocol      = "tcp"
      }]
      environment = [{ name = "API_UPSTREAM", value = "127.0.0.1:3000" }]
      dependsOn   = [{ containerName = "api", condition = "HEALTHY" }]
      healthCheck = {
        command     = ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1"]
        interval    = 15
        timeout     = 5
        retries     = 5
        startPeriod = 10
      }
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.web.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = "web"
        }
      }
    },
  ])
}

resource "aws_ecs_task_definition" "publisher" {
  family                   = "${local.name}-publisher"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.publisher.arn

  container_definitions = jsonencode([{
    name        = "publisher"
    image       = "${data.aws_ecr_repository.worker.repository_url}:${var.image_tag}"
    essential   = true
    command     = ["python", "-m", "generation_worker", "publisher"]
    environment = local.worker_environment
    secrets     = local.database_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.publisher.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "publisher"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${local.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.worker.arn

  container_definitions = jsonencode([{
    name        = "worker"
    image       = "${data.aws_ecr_repository.worker.repository_url}:${var.image_tag}"
    essential   = true
    command     = ["python", "-m", "generation_worker", "worker"]
    environment = local.worker_environment
    secrets     = local.database_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.worker.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "worker"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "migration" {
  family                   = "${local.name}-migration"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = 256
  memory                   = 512
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.migration.arn

  container_definitions = jsonencode([{
    name        = "migration"
    image       = "${data.aws_ecr_repository.migrate.repository_url}:${var.image_tag}"
    essential   = true
    environment = local.common_environment
    secrets     = local.database_secrets
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group         = aws_cloudwatch_log_group.migration.name
        awslogs-region        = var.aws_region
        awslogs-stream-prefix = "migration"
      }
    }
  }])
}

resource "aws_lb" "application" {
  name               = substr(local.name, 0, 32)
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.load_balancer.id]
  subnets            = aws_subnet.public[*].id

  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "application" {
  name        = substr("${local.name}-app", 0, 32)
  port        = 8080
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = aws_vpc.main.id

  deregistration_delay = 30

  health_check {
    enabled             = true
    path                = "/api/health/ready"
    matcher             = "200"
    interval            = 30
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.application.arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.application.arn
  }
}

resource "aws_ecs_service" "application" {
  name            = "application"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.application.arn
  desired_count   = var.application_desired_count
  launch_type     = "FARGATE"

  health_check_grace_period_seconds = 90

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.application.id]
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.application.arn
    container_name   = "web"
    container_port   = 8080
  }

  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "publisher" {
  name            = "publisher"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.publisher.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
  }
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = var.worker_desired_count
  launch_type     = "FARGATE"

  deployment_circuit_breaker {
    enable   = true
    rollback = true
  }

  network_configuration {
    assign_public_ip = true
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.worker.id]
  }
}

resource "aws_cloudwatch_metric_alarm" "unhealthy_application" {
  alarm_name          = "${local.name}-unhealthy-application"
  alarm_description   = "The application load balancer has an unhealthy portal/API target."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  metric_name         = "UnHealthyHostCount"
  namespace           = "AWS/ApplicationELB"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    LoadBalancer = aws_lb.application.arn_suffix
    TargetGroup  = aws_lb_target_group.application.arn_suffix
  }
}
