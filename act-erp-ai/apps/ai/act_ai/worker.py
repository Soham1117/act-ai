"""SQS-driven ingestion worker (Fargate `worker` container).

Same image as the agent service, different entrypoint (`python -m act_ai.worker`).
Polls SQS for ingestion jobs and runs the multi-format pipeline. Phase 0: poll
loop + dispatch stub; the pipeline lands in Phase 4.
"""

from __future__ import annotations

import asyncio
import json
import signal

import boto3

from act_ai.config import get_settings
from act_ai.db import close_pool, init_pool

_stop = asyncio.Event()


def _sqs_client():
    s = get_settings()
    return boto3.client("sqs", region_name=s.aws_region, endpoint_url=s.aws_endpoint_url)


async def handle_job(job: dict) -> None:
    """Dispatch one ingestion job. Implemented in Phase 4 (ingestion.pipeline)."""
    # from act_ai.ingestion.pipeline import ingest_document
    # await ingest_document(job["document_id"])
    print(f"[worker] received job (stub): {job}")


async def run() -> None:
    await init_pool()
    sqs = _sqs_client()
    queue_url = get_settings().sqs_queue_url
    print(f"[worker] polling {queue_url}")
    try:
        while not _stop.is_set():
            resp = await asyncio.to_thread(
                sqs.receive_message,
                QueueUrl=queue_url,
                MaxNumberOfMessages=5,
                WaitTimeSeconds=10,
            )
            for msg in resp.get("Messages", []):
                try:
                    await handle_job(json.loads(msg["Body"]))
                    await asyncio.to_thread(
                        sqs.delete_message,
                        QueueUrl=queue_url,
                        ReceiptHandle=msg["ReceiptHandle"],
                    )
                except Exception as exc:  # noqa: BLE001 - keep the loop alive
                    print(f"[worker] job failed, leaving for retry: {exc}")
    finally:
        await close_pool()


def main() -> None:
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    for sig in (signal.SIGINT, signal.SIGTERM):
        loop.add_signal_handler(sig, _stop.set)
    loop.run_until_complete(run())


if __name__ == "__main__":
    main()
