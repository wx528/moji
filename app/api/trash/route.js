import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { listTrash } from "@/lib/books";

export async function GET(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({ items: listTrash(email) });
}
