import { hashToken, type UserRole } from "@/server/auth";
import { prisma } from "@/server/db";

export type SessionIdentity = {
  userId: string;
  role: UserRole;
};

export async function resolveSessionIdentityFromToken(
  sessionToken: string | null | undefined,
): Promise<SessionIdentity | null> {
  if (!sessionToken) {
    return null;
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(sessionToken) },
    include: { user: true },
  });

  if (!session || session.revokedAt || session.expiresAt <= new Date()) {
    return null;
  }

  return {
    userId: session.userId,
    role: session.user.role,
  };
}
