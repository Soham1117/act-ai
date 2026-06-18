variable "region" {
  type    = string
  default = "us-east-2" # closest to Texas; native Bedrock region for Llama 3.3 70B
}

variable "name" {
  type    = string
  default = "act-erp-ai"
}

variable "agent_model" {
  type    = string
  default = "bedrock/us.meta.llama3-3-70b-instruct-v1:0"
}

variable "embed_model" {
  type    = string
  default = "bedrock/amazon.titan-embed-text-v2:0"
}

# Optional HTTPS. Provide an ACM cert ARN (in this region) to enable the 443
# listener; otherwise the ALB serves HTTP on 80 only.
variable "acm_certificate_arn" {
  type    = string
  default = ""
}

# Container sizes (Fargate). Small by default — ~500 queries/day.
variable "web_cpu" { default = 512 }
variable "web_memory" { default = 1024 }
variable "agent_cpu" { default = 512 }
variable "agent_memory" { default = 1024 }
variable "worker_cpu" { default = 512 }
variable "worker_memory" { default = 1024 }

variable "db_instance_class" {
  type    = string
  default = "db.t4g.micro"
}

# Secrets supplied out-of-band (terraform.tfvars or TF_VAR_*). Not committed.
variable "datalab_api_key" {
  type      = string
  default   = ""
  sensitive = true
}
