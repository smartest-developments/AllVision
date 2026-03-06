import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/server/auth";
import { resolveSessionIdentityFromToken } from "@/server/session-identity";

export async function resolvePageSessionIdentity() {
  let sessionToken: string | undefined;

  try {
    const cookieStore = await cookies();
    sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim();
  } catch {
    return null;
  }

  return resolveSessionIdentityFromToken(sessionToken);
}

export async function resolvePageSessionUserId(): Promise<string | null> {
  const identity = await resolvePageSessionIdentity();
  return identity?.userId ?? null;
}
