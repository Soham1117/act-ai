"""Runtime configuration. Values come from environment / .env (see .env.example).

Locked defaults reflect ARCHITECTURE.md: AWS us-east-2, Bedrock Llama 3.3 70B +
Titan Text Embeddings v2 (1024-dim).
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Database (Prisma owns the schema; we connect read-mostly via RLS role) ---
    database_url: str = "postgresql://act:act@localhost:5432/act"
    # Optional dedicated RLS role DSN for the agent/worker; falls back to database_url.
    rls_database_url: str | None = None

    # --- AWS / Bedrock ---
    aws_region: str = "us-east-2"
    embed_dims: int = 1024
    # Optional model overrides (env AGENT_MODEL / EMBED_MODEL). When set they win
    # over llm/models.yaml — prod sets these to Bedrock ids; local uses the yaml.
    agent_model: str | None = None
    embed_model: str | None = None

    # --- Object storage / queue (LocalStack locally, real AWS in prod) ---
    s3_bucket: str = "act-erp-ai-docs"
    sqs_queue_url: str = "http://localhost:4566/000000000000/act-ingestion"
    aws_endpoint_url: str | None = None  # set to LocalStack URL locally; None in prod

    # --- Document parsing ---
    datalab_api_key: str | None = None
    datalab_marker_url: str = "https://www.datalab.to/api/v1/marker"

    # --- Service-to-service auth (web -> agent) ---
    internal_service_token: str = "dev-insecure-change-me"

    # --- Agent loop ---
    max_agent_steps: int = 15

    # --- Ingestion ---
    parse_cache_prefix: str = "parses"  # S3 prefix for cached Marker payloads
    embed_batch_size: int = 64
    # Use deterministic local embeddings instead of Bedrock (dev/tests without AWS).
    embed_fake: bool = False
    # Run a real local embedding model (mxbai-embed-large-v1, 1024-d) instead of the
    # API — no rate limits; ingestion and queries stay consistent. Dev default.
    embed_local: bool = False
    embed_local_model: str = "mixedbread-ai/mxbai-embed-large-v1"

    @property
    def db_dsn(self) -> str:
        """DSN the agent/worker use for scoped reads (RLS role if provided)."""
        return self.rls_database_url or self.database_url


@lru_cache
def get_settings() -> Settings:
    return Settings()
