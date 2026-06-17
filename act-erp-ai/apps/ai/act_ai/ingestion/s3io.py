"""S3 access for ingestion (download source files, cache Marker parses)."""

from __future__ import annotations

import boto3
from botocore.exceptions import ClientError

from act_ai.config import get_settings


def _client():
    s = get_settings()
    return boto3.client("s3", region_name=s.aws_region, endpoint_url=s.aws_endpoint_url)


def download_bytes(key: str) -> bytes:
    s = get_settings()
    obj = _client().get_object(Bucket=s.s3_bucket, Key=key)
    return obj["Body"].read()


def get_cached_parse(checksum: str) -> bytes | None:
    s = get_settings()
    key = f"{s.parse_cache_prefix}/{checksum}.json"
    try:
        return _client().get_object(Bucket=s.s3_bucket, Key=key)["Body"].read()
    except ClientError:
        return None


def put_cached_parse(checksum: str, payload: bytes) -> None:
    s = get_settings()
    key = f"{s.parse_cache_prefix}/{checksum}.json"
    _client().put_object(Bucket=s.s3_bucket, Key=key, Body=payload, ContentType="application/json")


def put_image(key: str, data: bytes, content_type: str = "image/png") -> None:
    s = get_settings()
    _client().put_object(Bucket=s.s3_bucket, Key=key, Body=data, ContentType=content_type)
