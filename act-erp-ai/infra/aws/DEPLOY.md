# Deploy to AWS (Fargate/ECS) — no IaC, plain AWS CLI

A direct, transparent runbook. Uses your account's **default VPC** (no custom
networking to manage). Resources: ECR ×2, RDS Postgres (pgvector), S3, SQS (+DLQ),
Secrets Manager, IAM (2 roles), ECS Fargate ×3 (web/agent/worker) behind an ALB,
Cloud Map (web→agent), CloudWatch logs.

> Run top-to-bottom. Each block sets shell vars used by later blocks. Requires
> AWS CLI v2, Docker, and `envsubst` (gettext). Region defaults to us-east-2.
> **Enable Bedrock model access** (Llama 3.3 70B + Titan Embeddings v2) in the
> console first. **Phase 3b must be merged** (web image needs no Supabase env).

## 0. Vars + network (default VPC)
```bash
export REGION=us-east-2
export ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
export AGENT_MODEL="bedrock/us.meta.llama3-3-70b-instruct-v1:0"
export EMBED_MODEL="bedrock/amazon.titan-embed-text-v2:0"
aws configure set region $REGION

export VPC_ID=$(aws ec2 describe-vpcs --filters Name=isDefault,Values=true --query 'Vpcs[0].VpcId' --output text)
export SUBNETS=$(aws ec2 describe-subnets --filters Name=vpc-id,Values=$VPC_ID --query 'Subnets[].SubnetId' --output text | tr '\t' ',')
echo "VPC=$VPC_ID SUBNETS=$SUBNETS"
```

## 1. Security groups
```bash
export SG_ALB=$(aws ec2 create-security-group --group-name act-alb --description "act alb" --vpc-id $VPC_ID --query GroupId --output text)
export SG_SVC=$(aws ec2 create-security-group --group-name act-svc --description "act services" --vpc-id $VPC_ID --query GroupId --output text)
export SG_RDS=$(aws ec2 create-security-group --group-name act-rds --description "act rds" --vpc-id $VPC_ID --query GroupId --output text)

aws ec2 authorize-security-group-ingress --group-id $SG_ALB --protocol tcp --port 80 --cidr 0.0.0.0/0
aws ec2 authorize-security-group-ingress --group-id $SG_SVC --protocol tcp --port 3000 --source-group $SG_ALB
aws ec2 authorize-security-group-ingress --group-id $SG_SVC --protocol tcp --port 8001 --source-group $SG_SVC
aws ec2 authorize-security-group-ingress --group-id $SG_RDS --protocol tcp --port 5432 --source-group $SG_SVC
```

## 2. ECR + push images
```bash
aws ecr create-repository --repository-name act-erp-ai-web >/dev/null
aws ecr create-repository --repository-name act-erp-ai-ai  >/dev/null
export REG=$ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com
export WEB_IMAGE=$REG/act-erp-ai-web:latest
export AI_IMAGE=$REG/act-erp-ai-ai:latest
aws ecr get-login-password | docker login --username AWS --password-stdin $REG

docker build -f infra/Dockerfile.web -t $WEB_IMAGE apps/web && docker push $WEB_IMAGE
docker build -f infra/Dockerfile.ai  -t $AI_IMAGE  apps/ai  && docker push $AI_IMAGE
```

## 3. S3 + SQS
```bash
export S3_BUCKET=act-erp-ai-docs-$ACCOUNT_ID
aws s3api create-bucket --bucket $S3_BUCKET --create-bucket-configuration LocationConstraint=$REGION
aws s3api put-public-access-block --bucket $S3_BUCKET --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

aws sqs create-queue --queue-name act-ingestion-dlq >/dev/null
export DLQ_ARN=$(aws sqs get-queue-attributes --queue-url $(aws sqs get-queue-url --queue-name act-ingestion-dlq --query QueueUrl --output text) --attribute-names QueueArn --query Attributes.QueueArn --output text)
aws sqs create-queue --queue-name act-ingestion --attributes "{\"VisibilityTimeout\":\"900\",\"RedrivePolicy\":\"{\\\"deadLetterTargetArn\\\":\\\"$DLQ_ARN\\\",\\\"maxReceiveCount\\\":\\\"5\\\"}\"}" >/dev/null
export SQS_QUEUE_URL=$(aws sqs get-queue-url --queue-name act-ingestion --query QueueUrl --output text)
```

## 4. RDS Postgres (pgvector)
```bash
aws rds create-db-subnet-group --db-subnet-group-name act-db --db-subnet-group-description act \
  --subnet-ids $(echo $SUBNETS | tr ',' ' ')
export DB_PASSWORD=$(openssl rand -hex 16)
aws rds create-db-instance --db-instance-identifier act-erp-ai-pg --engine postgres --engine-version 16 \
  --db-instance-class db.t4g.micro --allocated-storage 20 --db-name act --master-username actmaster \
  --master-user-password "$DB_PASSWORD" --db-subnet-group-name act-db --vpc-security-group-ids $SG_RDS \
  --no-publicly-accessible --storage-encrypted --backup-retention-period 7
aws rds wait db-instance-available --db-instance-identifier act-erp-ai-pg
export DB_HOST=$(aws rds describe-db-instances --db-instance-identifier act-erp-ai-pg --query 'DBInstances[0].Endpoint.Address' --output text)
export RLS_PASSWORD=$(openssl rand -hex 16)
export DATABASE_URL="postgresql://actmaster:$DB_PASSWORD@$DB_HOST:5432/act"
export RLS_DATABASE_URL="postgresql://act_rls:$RLS_PASSWORD@$DB_HOST:5432/act"
```

## 5. Secrets Manager (capture ARNs for the task defs)
```bash
mk() { aws secretsmanager create-secret --name "act-erp-ai/$1" --secret-string "$2" --query ARN --output text; }
export SECRET_DATABASE_URL=$(mk DATABASE_URL "$DATABASE_URL")
export SECRET_DIRECT_URL=$(mk DIRECT_URL "$DATABASE_URL")
export SECRET_RLS_DATABASE_URL=$(mk RLS_DATABASE_URL "$RLS_DATABASE_URL")
export SECRET_AUTH_SECRET=$(mk AUTH_SECRET "$(openssl rand -base64 32)")
export SECRET_INTERNAL_SERVICE_TOKEN=$(mk INTERNAL_SERVICE_TOKEN "$(openssl rand -hex 24)")
export SECRET_DATALAB_API_KEY=$(mk DATALAB_API_KEY "${DATALAB_API_KEY:-none}")
```

## 6. IAM roles
```bash
cd infra/aws/iam
aws iam create-role --role-name act-erp-ai-exec --assume-role-policy-document file://ecs-tasks-trust.json
aws iam attach-role-policy --role-name act-erp-ai-exec --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g" execution-secrets.json > /tmp/exec-secrets.json
aws iam put-role-policy --role-name act-erp-ai-exec --policy-name read-secrets --policy-document file:///tmp/exec-secrets.json

aws iam create-role --role-name act-erp-ai-task --assume-role-policy-document file://ecs-tasks-trust.json
sed "s/<REGION>/$REGION/g; s/<ACCOUNT_ID>/$ACCOUNT_ID/g; s/<BUCKET>/$S3_BUCKET/g" task-policy.json > /tmp/task-policy.json
aws iam put-role-policy --role-name act-erp-ai-task --policy-name app-access --policy-document file:///tmp/task-policy.json
cd ../../..
```

## 7. Logs, cluster, Cloud Map
```bash
aws logs create-log-group --log-group-name /ecs/act-erp-ai
aws ecs create-cluster --cluster-name act-erp-ai
export NS_ID=$(aws servicediscovery create-private-dns-namespace --name act-erp-ai.local --vpc $VPC_ID --query OperationId --output text >/dev/null; aws servicediscovery list-namespaces --query "Namespaces[?Name=='act-erp-ai.local'].Id" --output text)
export SD_AGENT=$(aws servicediscovery create-service --name agent \
  --dns-config "NamespaceId=$NS_ID,DnsRecords=[{Type=A,TTL=10}]" --health-check-custom-config FailureThreshold=1 \
  --query Service.Arn --output text)
```

## 8. Register task definitions (envsubst fills the placeholders)
```bash
for t in web agent worker; do
  envsubst < infra/aws/ecs/$t.taskdef.json > /tmp/$t.json
  aws ecs register-task-definition --cli-input-json file:///tmp/$t.json >/dev/null
done
```

## 9. ALB → web, then the three services
```bash
export ALB_ARN=$(aws elbv2 create-load-balancer --name act-erp-ai --type application \
  --subnets $(echo $SUBNETS | tr ',' ' ') --security-groups $SG_ALB --query 'LoadBalancers[0].LoadBalancerArn' --output text)
export TG_ARN=$(aws elbv2 create-target-group --name act-erp-ai-web --protocol HTTP --port 3000 \
  --vpc-id $VPC_ID --target-type ip --health-check-path /login --matcher HttpCode=200-399 \
  --query 'TargetGroups[0].TargetGroupArn' --output text)
aws elbv2 create-listener --load-balancer-arn $ALB_ARN --protocol HTTP --port 80 \
  --default-actions Type=forward,TargetGroupArn=$TG_ARN >/dev/null

NET="awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$SG_SVC],assignPublicIp=ENABLED}"
aws ecs create-service --cluster act-erp-ai --service-name web --task-definition act-erp-ai-web \
  --desired-count 1 --launch-type FARGATE --network-configuration "$NET" \
  --load-balancers "targetGroupArn=$TG_ARN,containerName=web,containerPort=3000"
aws ecs create-service --cluster act-erp-ai --service-name agent --task-definition act-erp-ai-agent \
  --desired-count 1 --launch-type FARGATE --network-configuration "$NET" \
  --service-registries "registryArn=$SD_AGENT"
aws ecs create-service --cluster act-erp-ai --service-name worker --task-definition act-erp-ai-worker \
  --desired-count 1 --launch-type FARGATE --network-configuration "$NET"
```

## 10. Migrate the DB + first admin
From a host that can reach RDS (temporarily allow your IP on $SG_RDS, or use a bastion):
```bash
cd apps/web
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DATABASE_URL" pnpm prisma db push
psql "$DATABASE_URL" -f prisma/sql/01_rag_pgvector_rls.sql
psql "$DATABASE_URL" -c "ALTER ROLE act_rls LOGIN PASSWORD '$RLS_PASSWORD';"
pnpm tsx scripts/create-admin.ts you@actools.com 'StrongPass#1' 'You'   # with DATABASE_URL set
```
> Re-run the RLS SQL after any future `prisma db push` (it drops the tsv/HNSW/RLS objects).

## 11. Open it
```bash
aws elbv2 describe-load-balancers --load-balancer-arns $ALB_ARN --query 'LoadBalancers[0].DNSName' --output text
```
Browse `http://<that-dns>`, log in, upload a CSV, chat. Add HTTPS later with an ACM
cert + a 443 listener (and point a domain CNAME at the ALB).

## Updating later
CI (`.github/workflows/deploy.yml`) builds/pushes images and rolls services on push
to `main`. Or manually: `aws ecs update-service --cluster act-erp-ai --service <web|agent|worker> --force-new-deployment`.
