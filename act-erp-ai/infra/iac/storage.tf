data "aws_caller_identity" "current" {}

# --- ECR repos (one per image: web, ai) ---
resource "aws_ecr_repository" "web" {
  name                 = "${var.name}-web"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_ecr_repository" "ai" {
  name                 = "${var.name}-ai"
  image_tag_mutability = "MUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

# --- S3 bucket for uploads / parse cache / images (private) ---
resource "aws_s3_bucket" "docs" {
  bucket = "${var.name}-docs-${data.aws_caller_identity.current.account_id}"
}

resource "aws_s3_bucket_public_access_block" "docs" {
  bucket                  = aws_s3_bucket.docs.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# --- SQS ingestion queue (+ DLQ) ---
resource "aws_sqs_queue" "ingestion_dlq" {
  name = "${var.name}-ingestion-dlq"
}

resource "aws_sqs_queue" "ingestion" {
  name                       = "${var.name}-ingestion"
  visibility_timeout_seconds = 900 # >= longest ingest (Marker polling)
  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 5
  })
}
