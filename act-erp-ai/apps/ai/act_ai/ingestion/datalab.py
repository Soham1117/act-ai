"""Datalab Marker API client (PDF/DOCX → structured JSON).

Submit a file, poll until complete, return the parsed JSON payload. Results are
cached in S3 by checksum upstream (pipeline), so Datalab is paid once per unique
file. Requires DATALAB_API_KEY — the PDF/DOCX path can't run without it.
"""

from __future__ import annotations

import asyncio
import json

import httpx

from act_ai.config import get_settings

_POLL_INTERVAL_S = 2
_POLL_TIMEOUT_S = 600


async def parse_document(data: bytes, filename: str, mime_type: str) -> dict:
    s = get_settings()
    if not s.datalab_api_key:
        raise RuntimeError("DATALAB_API_KEY not set; cannot parse PDF/DOCX")

    headers = {"X-Api-Key": s.datalab_api_key}
    async with httpx.AsyncClient(timeout=60) as client:
        # Submit. output_format=json gives the block tree with bbox/polygon.
        files = {"file": (filename, data, mime_type)}
        form = {"output_format": "json", "paginate": "true"}
        resp = await client.post(s.datalab_marker_url, headers=headers, files=files, data=form)
        resp.raise_for_status()
        submit = resp.json()
        check_url = submit.get("request_check_url")
        if not check_url:
            raise RuntimeError(f"Datalab submit returned no check url: {submit}")

        # Poll until complete.
        waited = 0
        while waited < _POLL_TIMEOUT_S:
            await asyncio.sleep(_POLL_INTERVAL_S)
            waited += _POLL_INTERVAL_S
            poll = await client.get(check_url, headers=headers)
            poll.raise_for_status()
            body = poll.json()
            status = body.get("status")
            if status == "complete":
                if not body.get("success", True):
                    raise RuntimeError(f"Datalab parse failed: {body.get('error')}")
                return body
            if status == "failed":
                raise RuntimeError(f"Datalab parse failed: {body.get('error')}")
        raise TimeoutError("Datalab parse timed out")


def payload_bytes(payload: dict) -> bytes:
    return json.dumps(payload).encode()
