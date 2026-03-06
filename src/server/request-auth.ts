import type { NextRequest } from "next/server";

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

export function requireRequestUserId(request: NextRequest): string {
  const userId = request.headers.get("x-user-id")?.trim();
  if (!userId) {
    throw new RequestAuthError(401, "UNAUTHORIZED", "Authentication required.");
  }

  return userId;
}

export function requireRequestRole(request: NextRequest, requiredRole: RequestUserRole): string {
  const userId = requireRequestUserId(request);
  const userRole = request.headers.get("x-user-role");
  if (userRole !== requiredRole) {
    throw new RequestAuthError(403, "FORBIDDEN", "Admin access required.");
  }

  return userId;
}
