resource "aws_sqs_queue" "dead_letter" {
  name                      = "${local.name}-generation-dead-letter"
  message_retention_seconds = 1209600
  sqs_managed_sse_enabled   = true
}

resource "aws_sqs_queue" "generation" {
  name                       = "${local.name}-generation"
  visibility_timeout_seconds = 300
  receive_wait_time_seconds  = 20
  message_retention_seconds  = 345600
  sqs_managed_sse_enabled    = true

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.dead_letter.arn
    maxReceiveCount     = 5
  })
}

resource "aws_sqs_queue_redrive_allow_policy" "dead_letter" {
  queue_url = aws_sqs_queue.dead_letter.id
  redrive_allow_policy = jsonencode({
    redrivePermission = "byQueue"
    sourceQueueArns   = [aws_sqs_queue.generation.arn]
  })
}

resource "aws_cloudwatch_metric_alarm" "dead_letter_messages" {
  alarm_name          = "${local.name}-dead-letter-messages"
  alarm_description   = "Generation messages have exhausted their delivery attempts."
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 1
  metric_name         = "ApproximateNumberOfMessagesVisible"
  namespace           = "AWS/SQS"
  period              = 60
  statistic           = "Maximum"
  threshold           = 0
  treat_missing_data  = "notBreaching"

  dimensions = {
    QueueName = aws_sqs_queue.dead_letter.name
  }
}
