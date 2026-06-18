# Deploy (AWS, Terraform)

Provisions the full topology in `us-east-2`: VPC, RDS Postgres (pgvector), S3, SQS
(+DLQ), ECR ×2, ECS Fargate ×3 (web/agent/worker) behind an ALB, Cloud Map service
discovery (web→agent), Secrets Manager, IAM, CloudWatch logs.

> Not yet `terraform plan`-tested (no AWS creds in the dev box). Run `plan` and
> expect to tweak per-account values (AZs, instance sizes). Open an issue/ping if
> plan surfaces anything.

## Prerequisites
- Terraform ≥ 1.6, AWS CLI, Docker.
- An AWS account with permissions to create the above.
- **Enable Bedrock model access** for Llama 3.3 70B + Titan Embeddings v2 in
  `us-east-2` (Bedrock console → Model access).
- **Phase 3b must be done first** — the web image must not require Supabase env
  (this IaC injects no Supabase secrets).

## 1. Provision infra
```bash
cd infra/iac
cp terraform.tfvars.example terraform.tfvars   # edit
terraform init
terraform apply
```
Note the outputs: `ecr_web_repo`, `ecr_ai_repo`, `alb_url`, `rds_endpoint`,
and (sensitive) `rls_role_password`.

## 2. Build & push images
```bash
ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-2
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $ACCOUNT.dkr.ecr.$REGION.amazonaws.com

# web
docker build -f infra/Dockerfile.web -t $(terraform -chdir=infra/iac output -raw ecr_web_repo):latest apps/web
docker push $(terraform -chdir=infra/iac output -raw ecr_web_repo):latest
# ai
docker build -f infra/Dockerfile.ai -t $(terraform -chdir=infra/iac output -raw ecr_ai_repo):latest apps/ai
docker push $(terraform -chdir=infra/iac output -raw ecr_ai_repo):latest
```
(CI does this automatically — see `.github/workflows/deploy.yml`.)

## 3. Migrate the database (one time)
From a machine that can reach RDS (e.g. a bastion, or temporarily set the RDS SG
to allow your IP). Using the master URL from Secrets Manager:
```bash
# apply Prisma schema
cd apps/web
DATABASE_URL="<DATABASE_URL secret>" DIRECT_URL="<same>" pnpm prisma db push
# apply pgvector + RLS, then set the act_rls password to `rls_role_password`
psql "<DATABASE_URL secret>" -f prisma/sql/01_rag_pgvector_rls.sql
psql "<DATABASE_URL secret>" -c "ALTER ROLE act_rls LOGIN PASSWORD '<rls_role_password output>';"
```
> Re-run the RLS SQL after any future `prisma db push` (it drops the raw-SQL
> tsv/HNSW/RLS objects).

## 4. Roll the services
```bash
aws ecs update-service --cluster act-erp-ai --service web    --force-new-deployment
aws ecs update-service --cluster act-erp-ai --service agent  --force-new-deployment
aws ecs update-service --cluster act-erp-ai --service worker --force-new-deployment
```

## 5. First admin
Run `scripts/create-admin.ts` against the RDS `DATABASE_URL` (same as step 3),
then open `alb_url` and log in.

## Notes & hardening
- Services run in **public subnets** (no NAT, to save cost) with locked-down SGs.
  Harden by moving them to private subnets + a NAT gateway.
- `bedrock:InvokeModel` is `Resource:*` — scope to the specific model ARNs.
- Add HTTPS by setting `acm_certificate_arn` and pointing your domain at `alb_url`.
- `NEXT_PUBLIC_SITE_URL` is build-time; pass it as a Docker build-arg for correct
  invite/redirect links in prod.
