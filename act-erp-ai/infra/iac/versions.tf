terraform {
  required_version = ">= 1.6"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.60" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
  # Recommended: store state remotely once bootstrapped.
  # backend "s3" { bucket = "act-erp-ai-tfstate" key = "prod.tfstate" region = "us-east-2" }
}

provider "aws" {
  region = var.region
  default_tags {
    tags = { Project = "act-erp-ai", ManagedBy = "terraform" }
  }
}
