import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getBookById, createChapter } from "@/lib/books";

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
  if (!book || book.user_email !== email) {
    return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
  }

  const title = (body.title ?? "").trim() || "未命名章节";
  const id = createChapter({ bookId: book.id, title, parentId: body.parentId ?? null });
  return NextResponse.json({ ok: true, id });
}
