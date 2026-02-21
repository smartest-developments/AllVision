import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const SESSION_TTL_DAYS = 7;
const MIN_PASSWORD_LENGTH = 8;

export type UserRole = "USER" | "ADMIN";

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface SessionRecord {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  ipHash: string | null;
  userAgentHash: string | null;
  createdAt: Date;
}

export interface AuthStore {
  createUser: (data: {
    email: string;
    passwordHash: string;
    role: UserRole;
  }) => Promise<UserRecord>;
  findUserByEmail: (email: string) => Promise<UserRecord | null>;
  createSession: (data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipHash: string | null;
    userAgentHash: string | null;
  }) => Promise<SessionRecord>;
  revokeSessionByTokenHash: (tokenHash: string) => Promise<SessionRecord | null>;
  getSessionByTokenHash?: (tokenHash: string) => Promise<SessionRecord | null>;
}

export class AuthError extends Error {
  code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError("PASSWORD_TOO_SHORT", "Password does not meet minimum length.");
  }

  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  return bcrypt.compare(password, passwordHash);
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function defaultSessionExpiry(): Date {
  return new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
}

export function getSessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds
  };
}

export async function registerWithPassword(
  store: AuthStore,
  input: {
    email: string;
    password: string;
    role?: UserRole;
    ipHash?: string | null;
    userAgentHash?: string | null;
  }
) {
  const normalizedEmail = normalizeEmail(input.email);
  const existing = await store.findUserByEmail(normalizedEmail);
  if (existing) {
    throw new AuthError("EMAIL_IN_USE", "Email is already registered.");
  }

  const passwordHash = await hashPassword(input.password);
  const user = await store.createUser({
    email: normalizedEmail,
    passwordHash,
    role: input.role ?? "USER"
  });

  const sessionToken = generateSessionToken();
  const tokenHash = hashToken(sessionToken);
  const session = await store.createSession({
    userId: user.id,
    tokenHash,
    expiresAt: defaultSessionExpiry(),
    ipHash: input.ipHash ?? null,
    userAgentHash: input.userAgentHash ?? null
  });

  return { user, session, sessionToken };
}

export async function loginWithPassword(
  store: AuthStore,
  input: { email: string; password: string; ipHash?: string | null; userAgentHash?: string | null }
) {
  const normalizedEmail = normalizeEmail(input.email);
  const user = await store.findUserByEmail(normalizedEmail);
  if (!user) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const isValid = await verifyPassword(input.password, user.passwordHash);
  if (!isValid) {
    throw new AuthError("INVALID_CREDENTIALS", "Invalid email or password.");
  }

  const sessionToken = generateSessionToken();
  const tokenHash = hashToken(sessionToken);
  const session = await store.createSession({
    userId: user.id,
    tokenHash,
    expiresAt: defaultSessionExpiry(),
    ipHash: input.ipHash ?? null,
    userAgentHash: input.userAgentHash ?? null
  });

  return { user, session, sessionToken };
}

export async function logoutSession(store: AuthStore, sessionToken: string) {
  const tokenHash = hashToken(sessionToken);
  const session = await store.revokeSessionByTokenHash(tokenHash);
  return { session };
}
