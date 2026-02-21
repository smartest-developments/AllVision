import { randomUUID } from "node:crypto";
import type { AuthStore, SessionRecord, UserRecord, UserRole } from "@/server/auth";

export class InMemoryAuthStore implements AuthStore {
  private usersById = new Map<string, UserRecord>();
  private usersByEmail = new Map<string, UserRecord>();
  private sessionsByTokenHash = new Map<string, SessionRecord>();

  async createUser(data: { email: string; passwordHash: string; role: UserRole }): Promise<UserRecord> {
    if (this.usersByEmail.has(data.email)) {
      throw new Error("Duplicate email");
    }

    const now = new Date();
    const user: UserRecord = {
      id: randomUUID(),
      email: data.email,
      passwordHash: data.passwordHash,
      role: data.role,
      createdAt: now,
      updatedAt: now
    };

    this.usersById.set(user.id, user);
    this.usersByEmail.set(user.email, user);

    return user;
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.usersByEmail.get(email) ?? null;
  }

  async createSession(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
  }): Promise<SessionRecord> {
    const session: SessionRecord = {
      id: randomUUID(),
      userId: data.userId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
      revokedAt: null,
      ipHash: data.ipHash,
      userAgentHash: data.userAgentHash,
      createdAt: new Date()
    };

    this.sessionsByTokenHash.set(session.tokenHash, session);

    return session;
  }

  async revokeSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    const session = this.sessionsByTokenHash.get(tokenHash);
    if (!session) {
      return null;
    }

    const revoked = { ...session, revokedAt: new Date() };
    this.sessionsByTokenHash.set(tokenHash, revoked);

    return revoked;
  }

  async getSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
    return this.sessionsByTokenHash.get(tokenHash) ?? null;
  }
}
