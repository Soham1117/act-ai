import { createServer, type Server } from "node:http";

/**
 * Tiny in-memory S3 stand-in (path-style) so upload/download flows work in
 * tests with no AWS or LocalStack. Started by global-setup in the Playwright
 * runner process. Test workers inspect it over HTTP:
 *   GET  /__keys            -> JSON array of stored keys ("bucket/key")
 *   POST /__reset           -> forget everything
 * Supports PUT / GET / HEAD / DELETE object, including the aws-chunked body
 * encoding the AWS SDK v3 uses for uploads.
 */
type Obj = { body: Buffer; contentType: string };

function decodeAwsChunked(buf: Buffer): Buffer {
  const parts: Buffer[] = [];
  let pos = 0;
  while (pos < buf.length) {
    const lineEnd = buf.indexOf("\r\n", pos);
    if (lineEnd === -1) break;
    const size = parseInt(buf.subarray(pos, lineEnd).toString().split(";")[0]!, 16);
    if (!Number.isFinite(size) || size === 0) break;
    parts.push(buf.subarray(lineEnd + 2, lineEnd + 2 + size));
    pos = lineEnd + 2 + size + 2;
  }
  return Buffer.concat(parts);
}

export function startFakeS3(port: number): Promise<Server> {
  const store = new Map<string, Obj>();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://x");
    const key = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (url.pathname === "/__keys") {
        res.setHeader("content-type", "application/json");
        return void res.end(JSON.stringify([...store.keys()]));
      }
      if (url.pathname === "/__reset") {
        store.clear();
        return void res.end("ok");
      }
      if (req.method === "PUT") {
        let body: Buffer = Buffer.concat(chunks);
        const sha = String(req.headers["x-amz-content-sha256"] ?? "");
        if (sha.startsWith("STREAMING") || req.headers["content-encoding"]?.includes("aws-chunked")) {
          body = decodeAwsChunked(body);
        }
        store.set(key, { body, contentType: String(req.headers["content-type"] ?? "application/octet-stream") });
        res.setHeader("etag", '"fake"');
        return void res.end();
      }
      const obj = store.get(key);
      if (req.method === "DELETE") {
        store.delete(key);
        res.statusCode = 204;
        return void res.end();
      }
      if (!obj) {
        res.statusCode = 404;
        res.setHeader("content-type", "application/xml");
        return void res.end(
          '<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>not found</Message></Error>',
        );
      }
      res.setHeader("content-type", obj.contentType);
      res.setHeader("content-length", String(obj.body.length));
      res.setHeader("etag", '"fake"');
      return void res.end(req.method === "HEAD" ? undefined : obj.body);
    });
  });
  return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
}

/** Keys currently stored, as seen by a test worker. */
export async function fakeS3Keys(): Promise<string[]> {
  const res = await fetch(`${process.env.AWS_ENDPOINT_URL}/__keys`);
  return (await res.json()) as string[];
}
