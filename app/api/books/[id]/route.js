import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { deleteBook } from "@/lib/books";

export async function DELETE(req, { params }) {
  const { id } = await params;
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  if (!deleteBook(email, id)) {
    return NextResponse.json({ error: "书籍不存在" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
