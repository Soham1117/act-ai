resource "random_password" "auth_secret" {
  length  = 32
  special = false
}

resource "random_password" "service_token" {
  length  = 32
  special = false
}

# Each app secret is a separate Secrets Manager entry; task definitions inject
# them by ARN (see ecs.tf `secrets`). Values that depend on RDS are built here.
locals {
  secret_values = {
    DATABASE_URL           = local.database_url
    DIRECT_URL             = local.database_url
    RLS_DATABASE_URL       = local.rls_database_url
    AUTH_SECRET            = random_password.auth_secret.result
    INTERNAL_SERVICE_TOKEN = random_password.service_token.result
    DATALAB_API_KEY        = var.datalab_api_key
  }
}

resource "aws_secretsmanager_secret" "app" {
  for_each = local.secret_values
  name     = "${var.name}/${each.key}"
}

resource "aws_secretsmanager_secret_version" "app" {
  for_each      = local.secret_values
  secret_id     = aws_secretsmanager_secret.app[each.key].id
  secret_string = each.value
}
