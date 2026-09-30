import { NextResponse } from "next/server";
import { verifySession } from "@/lib/auth";
import {
  getChapterWithBook,
  updateChapter,
  softDeleteChapter,
  purgeChapter,
} from "@/lib/books";
import { recordWordDelta, countWords } from "@/lib/stats";

async function authorize(req, id) {
  const email = verifySession(req.cookies.get("moji_session")?.value);
  if (!email) return { error: NextResponse.json({ error: "未登录" }, { status: 401 }) };
  const chapter = getChapterWithBook(id);
  if (!chapter || chapter.user_email !== email) {
    return { error: NextResponse.json({ error: "章节不存在" }, { status: 404 }) };
  }
  return { chapter };
}

export async function PATCH(req, { params }) {
  const { id } = await params;
  const { error, chapter } = await authorize(req, id);
  if (error) return error;

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  if (body.content !== undefined) {
    recordWordDelta(
      chapter.user_email,
      countWords(body.content) - countWords(chapter.content)
    );
  }

  updateChapter(id, { title: body.title, content: body.content });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req, { params }) {
  const { id } = await params;
  const { error } = await authorize(req, id);
  if (error) return error;

  if (new URL(req.url).searchParams.get("permanent") === "1") {
    purgeChapter(id);
  } else {
    softDeleteChapter(id);
  }
  return NextResponse.json({ ok: true });
}
