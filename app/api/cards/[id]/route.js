import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getCardWithBook, updateCard } from "@/lib/books";

export async function PATCH(req, { params }) {
  const { id } = await params;
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const card = getCardWithBook(id);
  if (!card || card.user_email !== email) {
    return NextResponse.json({ error: "卡片不存在" }, { status: 404 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  updateCard(id, { title: body.title, body: body.body });
  return NextResponse.json({ ok: true });
}
