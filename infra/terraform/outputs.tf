output "application_url" {
  description = "Public researcher portal URL."
  value       = "http://${aws_lb.application.dns_name}"
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.main.name
}

output "application_service_name" {
  value = aws_ecs_service.application.name
}

output "publisher_service_name" {
  value = aws_ecs_service.publisher.name
}

output "worker_service_name" {
  value = aws_ecs_service.worker.name
}

output "migration_task_definition_arn" {
  value = aws_ecs_task_definition.migration.arn
}

output "public_subnet_ids" {
  value = aws_subnet.public[*].id
}

output "worker_security_group_id" {
  value = aws_security_group.worker.id
}

output "generation_queue_url" {
  value = aws_sqs_queue.generation.url
}

output "generation_dead_letter_queue_url" {
  value = aws_sqs_queue.dead_letter.url
}
