import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import { listBooksWithStats, createBook } from "@/lib/books";

export async function GET(req) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  return NextResponse.json({ books: listBooksWithStats(email) });
}

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
  const title = (body.title ?? "").trim();
  if (!title) {
    return NextResponse.json({ error: "书名不能为空" }, { status: 400 });
  }
  const id = createBook(email, title);
  return NextResponse.json({ ok: true, id });
}
