import type { NextRequest } from "next/server";
import { SESSION_COOKIE_NAME, type UserRole } from "@/server/auth";
import { resolveSessionIdentityFromToken } from "@/server/session-identity";

export type RequestUserRole = "USER" | "ADMIN";

export class RequestAuthError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

type RequestIdentity = {
  userId: string;
  role: UserRole;
};

export async function resolveIdentityFromSessionToken(
  sessionToken: string | null | undefined,
): Promise<RequestIdentity | null> {
  return resolveSessionIdentityFromToken(sessionToken);
}

async function resolveRequestIdentity(request: NextRequest): Promise<RequestIdentity> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  const identity = await resolveIdentityFromSessionToken(sessionToken);
  if (!identity) {
    throw new RequestAuthError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return identity;
}

export async function requireRequestIdentity(
  request: NextRequest
): Promise<RequestIdentity> {
  return resolveRequestIdentity(request);
}

export async function requireRequestUserId(request: NextRequest): Promise<string> {
  const identity = await resolveRequestIdentity(request);
  return identity.userId;
}

export async function requireRequestRole(
  request: NextRequest,
  requiredRole: RequestUserRole,
): Promise<string> {
  const identity = await resolveRequestIdentity(request);
  if (identity.role !== requiredRole) {
    throw new RequestAuthError(403, "FORBIDDEN", "Admin access required.");
  }

  return identity.userId;
}
