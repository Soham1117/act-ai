#!/bin/bash
# Provisions local S3 bucket + SQS queue on LocalStack startup so dev mirrors AWS.
set -e
awslocal s3 mb s3://act-erp-ai-docs || true
awslocal sqs create-queue --queue-name act-ingestion || true
echo "localstack: S3 bucket + SQS queue ready"
