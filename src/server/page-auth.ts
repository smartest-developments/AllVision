import { cookies } from "next/headers";
import { SESSION_COOKIE_NAME } from "@/server/auth";
import { resolveIdentityFromSessionToken } from "@/server/request-auth";

export async function resolvePageSessionUserId(): Promise<string | null> {
  let sessionToken: string | undefined;

  try {
    const cookieStore = await cookies();
    sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value?.trim();
  } catch {
    return null;
  }

  const identity = await resolveIdentityFromSessionToken(sessionToken);
  return identity?.userId ?? null;
}
