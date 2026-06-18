locals {
  web_image    = "${aws_ecr_repository.web.repository_url}:latest"
  ai_image     = "${aws_ecr_repository.ai.repository_url}:latest"
  agent_dns    = "agent.${var.name}.local"
  log_region   = var.region

  # secret ARN helpers for container `secrets`
  s = { for k, v in aws_secretsmanager_secret.app : k => v.arn }
}

resource "aws_cloudwatch_log_group" "main" {
  name              = "/ecs/${var.name}"
  retention_in_days = 30
}

resource "aws_ecs_cluster" "main" {
  name = var.name
}

# ----------------------------------------------------------------------------
# ALB → web
# ----------------------------------------------------------------------------
resource "aws_lb" "main" {
  name               = var.name
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
}

resource "aws_lb_target_group" "web" {
  name        = "${var.name}-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/login"
    matcher             = "200-399"
    interval            = 30
    healthy_threshold   = 2
    unhealthy_threshold = 5
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.main.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.acm_certificate_arn == "" ? 0 : 1
  load_balancer_arn = aws_lb.main.arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.acm_certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

# ----------------------------------------------------------------------------
# Task definitions
# ----------------------------------------------------------------------------
resource "aws_ecs_task_definition" "web" {
  family                   = "${var.name}-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.web_cpu
  memory                   = var.web_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "web"
    image     = local.web_image
    essential = true
    portMappings = [{ containerPort = 3000 }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "AWS_REGION", value = var.region },
      { name = "S3_BUCKET", value = aws_s3_bucket.docs.bucket },
      { name = "SQS_QUEUE_URL", value = aws_sqs_queue.ingestion.url },
      { name = "AGENT_SERVICE_URL", value = "http://${local.agent_dns}:8001" },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = local.s["DATABASE_URL"] },
      { name = "DIRECT_URL", valueFrom = local.s["DIRECT_URL"] },
      { name = "AUTH_SECRET", valueFrom = local.s["AUTH_SECRET"] },
      { name = "INTERNAL_SERVICE_TOKEN", valueFrom = local.s["INTERNAL_SERVICE_TOKEN"] },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = { "awslogs-group" = aws_cloudwatch_log_group.main.name, "awslogs-region" = local.log_region, "awslogs-stream-prefix" = "web" }
    }
  }])
}

resource "aws_ecs_task_definition" "agent" {
  family                   = "${var.name}-agent"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.agent_cpu
  memory                   = var.agent_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name        = "agent"
    image       = local.ai_image
    essential   = true
    command     = ["uvicorn", "act_ai.main:app", "--host", "0.0.0.0", "--port", "8001"]
    portMappings = [{ containerPort = 8001 }]
    environment = [
      { name = "AWS_REGION", value = var.region },
      { name = "S3_BUCKET", value = aws_s3_bucket.docs.bucket },
      { name = "SQS_QUEUE_URL", value = aws_sqs_queue.ingestion.url },
      { name = "EMBED_FAKE", value = "false" },
      { name = "AGENT_MODEL", value = var.agent_model },
      { name = "EMBED_MODEL", value = var.embed_model },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = local.s["DATABASE_URL"] },
      { name = "RLS_DATABASE_URL", valueFrom = local.s["RLS_DATABASE_URL"] },
      { name = "INTERNAL_SERVICE_TOKEN", valueFrom = local.s["INTERNAL_SERVICE_TOKEN"] },
      { name = "DATALAB_API_KEY", valueFrom = local.s["DATALAB_API_KEY"] },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = { "awslogs-group" = aws_cloudwatch_log_group.main.name, "awslogs-region" = local.log_region, "awslogs-stream-prefix" = "agent" }
    }
  }])
}

resource "aws_ecs_task_definition" "worker" {
  family                   = "${var.name}-worker"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = var.worker_cpu
  memory                   = var.worker_memory
  execution_role_arn       = aws_iam_role.execution.arn
  task_role_arn            = aws_iam_role.task.arn
  container_definitions = jsonencode([{
    name      = "worker"
    image     = local.ai_image
    essential = true
    command   = ["python", "-m", "act_ai.worker"]
    environment = [
      { name = "AWS_REGION", value = var.region },
      { name = "S3_BUCKET", value = aws_s3_bucket.docs.bucket },
      { name = "SQS_QUEUE_URL", value = aws_sqs_queue.ingestion.url },
      { name = "EMBED_FAKE", value = "false" },
      { name = "EMBED_MODEL", value = var.embed_model },
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = local.s["DATABASE_URL"] },
      { name = "DATALAB_API_KEY", valueFrom = local.s["DATALAB_API_KEY"] },
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = { "awslogs-group" = aws_cloudwatch_log_group.main.name, "awslogs-region" = local.log_region, "awslogs-stream-prefix" = "worker" }
    }
  }])
}

# ----------------------------------------------------------------------------
# Services
# ----------------------------------------------------------------------------
resource "aws_ecs_service" "web" {
  name            = "web"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "web"
    container_port   = 3000
  }
  depends_on = [aws_lb_listener.http]
}

resource "aws_ecs_service" "agent" {
  name            = "agent"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.agent.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }
  service_registries {
    registry_arn = aws_service_discovery_service.agent.arn
  }
}

resource "aws_ecs_service" "worker" {
  name            = "worker"
  cluster         = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.worker.arn
  desired_count   = 1
  launch_type     = "FARGATE"
  network_configuration {
    subnets          = aws_subnet.public[*].id
    security_groups  = [aws_security_group.service.id]
    assign_public_ip = true
  }
}
