import { NextResponse } from "next/server";

export async function GET() {
  const now = new Date();

  try {
    // Dynamically import to avoid throwing at module load if env is invalid.
    const { prisma } = await import("@/server/db");

    // Verify DB connectivity with a lightweight query.
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json(
      {
        status: "ready",
        checks: {
          db: "ok"
        },
        now: now.toISOString()
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        status: "degraded",
        checks: {
          db: "fail"
        },
        now: now.toISOString(),
        error: {
          code: "READINESS_CHECK_FAILED",
          message
        }
      },
      { status: 503 }
    );
  }
}
