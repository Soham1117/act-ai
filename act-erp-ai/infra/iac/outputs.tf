output "alb_url" {
  value       = "http://${aws_lb.main.dns_name}"
  description = "Public URL of the app (point your domain's CNAME here; add ACM cert for HTTPS)."
}

output "ecr_web_repo" {
  value = aws_ecr_repository.web.repository_url
}

output "ecr_ai_repo" {
  value = aws_ecr_repository.ai.repository_url
}

output "s3_bucket" {
  value = aws_s3_bucket.docs.bucket
}

output "sqs_queue_url" {
  value = aws_sqs_queue.ingestion.url
}

output "rds_endpoint" {
  value = aws_db_instance.main.address
}

output "rds_master_password" {
  value     = random_password.db_master.result
  sensitive = true
}

# Set the act_rls role's password to this after running the RLS SQL (see README).
output "rls_role_password" {
  value     = random_password.rls.result
  sensitive = true
}
