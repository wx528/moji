import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getBookById, createCard } from "@/lib/books";

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

  const book = getBookById(body.bookId);
  if (!book || book.user_email !== email || book.deleted) {
    return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
  }

  const tab = body.tab === "outline" ? "outline" : "notes";
  const id = createCard({ bookId: book.id, tab, title: body.title });
  return NextResponse.json({ ok: true, id });
}
