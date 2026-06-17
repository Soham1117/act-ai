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
from act_ai.db import close_pool, init_owner_pool
from act_ai.ingestion.pipeline import ingest_document

_stop = asyncio.Event()


def _sqs_client():
    s = get_settings()
    return boto3.client("sqs", region_name=s.aws_region, endpoint_url=s.aws_endpoint_url)


async def handle_job(job: dict) -> None:
    """Dispatch one ingestion job from SQS."""
    doc_id = job.get("document_id")
    if not doc_id:
        print(f"[worker] skipping job without document_id: {job}")
        return
    stats = await ingest_document(doc_id)
    print(f"[worker] ingested {doc_id}: {stats}")


async def run() -> None:
    await init_owner_pool()
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
