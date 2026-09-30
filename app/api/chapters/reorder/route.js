import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { reorderChapters } from "@/lib/books";

export async function POST(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const ids = Array.isArray(body.ids) ? body.ids.filter((id) => typeof id === "string") : [];
  if (!ids.length) {
    return NextResponse.json({ error: "缺少排序 ID 列表" }, { status: 400 });
  }

  reorderChapters(email, ids);
  return NextResponse.json({ ok: true });
}
