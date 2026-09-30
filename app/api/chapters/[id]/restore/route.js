import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getChapterWithBook, restoreChapter } from "@/lib/books";

export async function POST(req, { params }) {
  const { id } = await params;
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const chapter = getChapterWithBook(id);
  if (!chapter || chapter.user_email !== email) {
    return NextResponse.json({ error: "章节不存在" }, { status: 404 });
  }
  restoreChapter(id);
  return NextResponse.json({ ok: true });
}
