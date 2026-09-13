data "aws_iam_policy_document" "ecs_assume_role" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "execution" {
  name               = "${local.name}-ecs-execution"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role_policy_attachment" "execution" {
  role       = aws_iam_role.execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

data "aws_iam_policy_document" "database_secret" {
  statement {
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [aws_db_instance.database.master_user_secret[0].secret_arn]
  }
}

resource "aws_iam_role_policy" "database_secret" {
  name   = "database-secret"
  role   = aws_iam_role.execution.id
  policy = data.aws_iam_policy_document.database_secret.json
}

resource "aws_iam_role" "api" {
  name               = "${local.name}-api-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

resource "aws_iam_role" "publisher" {
  name               = "${local.name}-publisher-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

data "aws_iam_policy_document" "publisher_queue" {
  statement {
    actions   = ["sqs:GetQueueAttributes", "sqs:GetQueueUrl", "sqs:SendMessage"]
    resources = [aws_sqs_queue.generation.arn]
  }
}

resource "aws_iam_role_policy" "publisher_queue" {
  name   = "generation-queue-publish"
  role   = aws_iam_role.publisher.id
  policy = data.aws_iam_policy_document.publisher_queue.json
}

resource "aws_iam_role" "worker" {
  name               = "${local.name}-worker-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}

data "aws_iam_policy_document" "worker_queue" {
  statement {
    actions = [
      "sqs:ChangeMessageVisibility",
      "sqs:DeleteMessage",
      "sqs:GetQueueAttributes",
      "sqs:GetQueueUrl",
      "sqs:ReceiveMessage",
    ]
    resources = [aws_sqs_queue.generation.arn]
  }
}

resource "aws_iam_role_policy" "worker_queue" {
  name   = "generation-queue-consume"
  role   = aws_iam_role.worker.id
  policy = data.aws_iam_policy_document.worker_queue.json
}

resource "aws_iam_role" "migration" {
  name               = "${local.name}-migration-task"
  assume_role_policy = data.aws_iam_policy_document.ecs_assume_role.json
}
