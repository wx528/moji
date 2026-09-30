import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { getBookForUser, getChapterTree, getCards } from "@/lib/books";

export async function GET(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const bookId = new URL(req.url).searchParams.get("bookId");
  const book = getBookForUser(email, bookId);
  return NextResponse.json({
    book: { id: book.id, title: book.title },
    chapters: getChapterTree(book.id),
    cards: getCards(book.id),
  });
}
