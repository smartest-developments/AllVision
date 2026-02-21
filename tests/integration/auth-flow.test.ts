import { describe, expect, it } from "vitest";
import {
  AuthError,
  getSessionCookieOptions,
  loginWithPassword,
  logoutSession,
  registerWithPassword
} from "@/server/auth";
import { InMemoryAuthStore } from "@/server/inmemory-auth-store";

describe("auth flow", () => {
  it("registers a new user and creates a session", async () => {
    const store = new InMemoryAuthStore();

    const result = await registerWithPassword(store, {
      email: "User@Example.com",
      password: "strong-password"
    });

    expect(result.user.email).toBe("user@example.com");
    expect(result.user.passwordHash).not.toBe("strong-password");
    expect(result.sessionToken.length).toBeGreaterThan(20);

    const cookie = getSessionCookieOptions(60 * 60 * 24 * 7);
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.secure).toBe(true);
  });

  it("rejects duplicate registration", async () => {
    const store = new InMemoryAuthStore();

    await registerWithPassword(store, {
      email: "dup@example.com",
      password: "strong-password"
    });

    await expect(
      registerWithPassword(store, {
        email: "dup@example.com",
        password: "strong-password"
      })
    ).rejects.toMatchObject({ code: "EMAIL_IN_USE" });
  });

  it("logs in and creates a new session", async () => {
    const store = new InMemoryAuthStore();

    await registerWithPassword(store, {
      email: "login@example.com",
      password: "strong-password"
    });

    const result = await loginWithPassword(store, {
      email: "login@example.com",
      password: "strong-password"
    });

    expect(result.sessionToken.length).toBeGreaterThan(20);
    expect(result.user.email).toBe("login@example.com");
  });

  it("rejects invalid credentials", async () => {
    const store = new InMemoryAuthStore();

    await registerWithPassword(store, {
      email: "badpass@example.com",
      password: "strong-password"
    });

    await expect(
      loginWithPassword(store, {
        email: "badpass@example.com",
        password: "wrong-password"
      })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });

    await expect(
      loginWithPassword(store, {
        email: "missing@example.com",
        password: "strong-password"
      })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });

  it("revokes a session on logout", async () => {
    const store = new InMemoryAuthStore();

    const { sessionToken } = await registerWithPassword(store, {
      email: "logout@example.com",
      password: "strong-password"
    });

    const result = await logoutSession(store, sessionToken);
    expect(result.session?.revokedAt).toBeInstanceOf(Date);

    const stored = await store.getSessionByTokenHash?.(result.session!.tokenHash);
    expect(stored?.revokedAt).toBeInstanceOf(Date);
  });

  it("surfaces password policy errors", async () => {
    const store = new InMemoryAuthStore();

    await expect(
      registerWithPassword(store, {
        email: "short@example.com",
        password: "short"
      })
    ).rejects.toBeInstanceOf(AuthError);
  });
});
