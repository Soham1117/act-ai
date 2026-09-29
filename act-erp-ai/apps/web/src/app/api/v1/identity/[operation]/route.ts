import { NextRequest, NextResponse } from "next/server";
import {
  createPersonaIdentityAdapter,
  IdentityAdapterError,
} from "@/lib/customer-portal-identity/adapter";
import {
  authenticateServiceRequest,
  ServiceAuthError,
} from "@/lib/customer-portal-identity/service-auth";

export const runtime = "nodejs";

type RouteContext = { params: Promise<{ operation: string }> };

function response(body: Record<string, unknown>, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function adapterError(error: IdentityAdapterError): NextResponse {
  if (error.code === "RATE_LIMITED") return response({ error: "RATE_LIMITED" }, 429);
  return error.code === "AUTHENTICATION_FAILED"
    ? response({ error: "AUTHENTICATION_FAILED" }, 401)
    : response({ error: "IDENTITY_UNAVAILABLE" }, 503);
}

function serviceError(error: ServiceAuthError): NextResponse {
  return error.code === "AUTHENTICATION_FAILED"
    ? response({ error: "AUTHENTICATION_FAILED" }, 401)
    : response({ error: "IDENTITY_UNAVAILABLE" }, 503);
}

export async function POST(request: NextRequest, context: RouteContext): Promise<NextResponse> {
  const { operation } = await context.params;
  const body = await request.text();

  try {
    await authenticateServiceRequest({
      method: request.method,
      path: `${request.nextUrl.pathname}${request.nextUrl.search}`,
      body,
      headers: request.headers,
    });
  } catch (error) {
    if (error instanceof ServiceAuthError) return serviceError(error);
    return response({ error: "IDENTITY_UNAVAILABLE" }, 503);
  }

  if (!["begin", "finish", "status"].includes(operation)) {
    return response({ error: "NOT_FOUND" }, 404);
  }

  let parsed: unknown = null;
  if (body.length > 0) {
    try {
      parsed = JSON.parse(body) as unknown;
    } catch {
      parsed = null;
    }
  }
  if (!isRecord(parsed)) return response({ error: "INVALID_REQUEST" }, 400);

  try {
    const adapter = createPersonaIdentityAdapter();
    if (operation === "begin") {
      if (
        typeof parsed.login !== "string" ||
        typeof parsed.password !== "string" ||
        typeof parsed.nonce !== "string"
      ) {
        return response({ error: "INVALID_REQUEST" }, 400);
      }
      return response(await adapter.begin({ login: parsed.login, password: parsed.password, nonce: parsed.nonce }), 200);
    }
    if (operation === "finish") {
      if (
        typeof parsed.challengeId !== "string" ||
        (parsed.otp !== undefined && typeof parsed.otp !== "string")
      ) {
        return response({ error: "INVALID_REQUEST" }, 400);
      }
      return response(
        await adapter.finish({
          challengeId: parsed.challengeId,
          ...(parsed.otp === undefined ? {} : { otp: parsed.otp }),
        }),
        200,
      );
    }
    if (typeof parsed.personaUserId !== "string") {
      return response({ error: "INVALID_REQUEST" }, 400);
    }
    return response(await adapter.status({ personaUserId: parsed.personaUserId }), 200);
  } catch (error) {
    if (error instanceof IdentityAdapterError) return adapterError(error);
    return response({ error: "IDENTITY_UNAVAILABLE" }, 503);
  }
}
