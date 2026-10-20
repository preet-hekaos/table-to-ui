output "cluster_name" {
  value = module.eks.cluster_name
}

output "primary_db_endpoint" {
  value = aws_db_instance.primary.address
}

output "analytics_db_endpoint" {
  value = aws_db_instance.analytics.address
}

output "primary_db_secret_arn" {
  description = "Secrets Manager secret holding the generated master password."
  value       = aws_db_instance.primary.master_user_secret[0].secret_arn
}

output "valkey_endpoint" {
  value = aws_elasticache_replication_group.valkey.primary_endpoint_address
}

output "files_bucket" {
  value = aws_s3_bucket.files.bucket
}

output "events_queue_url" {
  value = aws_sqs_queue.events.url
}

output "github_deploy_role_arn" {
  value = aws_iam_role.github_deploy.arn
}
