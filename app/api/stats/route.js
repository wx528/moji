import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getStats } from "@/lib/stats";

export async function GET(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const days = Math.min(
    60,
    Math.max(7, parseInt(new URL(req.url).searchParams.get("days") ?? "14", 10) || 14)
  );
  return NextResponse.json(getStats(email, days));
}
