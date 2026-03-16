import { NextResponse } from "next/server";

export async function GET() {
  const now = new Date();
  const uptimeSec = Math.floor(process.uptime());

  return NextResponse.json(
    {
      status: "ok",
      service: "AllVision",
      now: now.toISOString(),
      uptimeSec
    },
    { status: 200 }
  );
}
