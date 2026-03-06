import type { NextRequest } from "next/server";
import { hashToken, SESSION_COOKIE_NAME, type UserRole } from "@/server/auth";
import { prisma } from "@/server/db";

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

async function resolveRequestIdentity(request: NextRequest): Promise<RequestIdentity> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value?.trim();
  if (!sessionToken) {
    throw new RequestAuthError(401, "UNAUTHORIZED", "Authentication required.");
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
    include: { user: true }
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    throw new RequestAuthError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return {
    userId: session.userId,
    role: session.user.role
  };
}

export async function requireRequestUserId(request: NextRequest): Promise<string> {
  const identity = await resolveRequestIdentity(request);
  return identity.userId;
}

export async function requireRequestRole(
  request: NextRequest,
  requiredRole: RequestUserRole
): Promise<string> {
  const identity = await resolveRequestIdentity(request);
  if (identity.role !== requiredRole) {
    throw new RequestAuthError(403, "FORBIDDEN", "Admin access required.");
  }

  return identity.userId;
}
