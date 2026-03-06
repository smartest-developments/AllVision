import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/server/auth";
import { resolveSessionIdentityFromToken } from "@/server/session-identity";

export async function resolvePageSessionUserId(): Promise<string | null> {
  let sessionToken: string | undefined;

  try {
    const cookieStore = await cookies();
    sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim();
  } catch {
    return null;
  }

  const identity = await resolveSessionIdentityFromToken(sessionToken);
  return identity?.userId ?? null;
}
