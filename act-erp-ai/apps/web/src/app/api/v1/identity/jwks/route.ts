import { NextResponse } from "next/server";
import {
  createPersonaIdentityAdapter,
  IdentityAdapterError,
} from "@/lib/customer-portal-identity/adapter";

export const runtime = "nodejs";

export async function GET(): Promise<NextResponse> {
  try {
    const adapter = createPersonaIdentityAdapter();
    return NextResponse.json(adapter.jwks(), {
      status: 200,
      headers: {
        "cache-control": "public, max-age=300, must-revalidate",
      },
    });
  } catch (error) {
    const status = error instanceof IdentityAdapterError && error.code === "AUTHENTICATION_FAILED" ? 401 : 503;
    return NextResponse.json(
      { error: "IDENTITY_UNAVAILABLE" },
      { status, headers: { "cache-control": "no-store" } },
    );
  }
}
