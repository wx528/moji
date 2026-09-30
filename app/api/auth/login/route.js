import { NextResponse } from "next/server";
import { findUser, checkPassword, signSession } from "@/lib/auth";

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const password = body.password ?? "";

  if (!email || !password) {
    return NextResponse.json({ error: "请填写邮箱和密码" }, { status: 400 });
  }

  const user = findUser(email);
  if (!user || !checkPassword(user, password)) {
    return NextResponse.json({ error: "邮箱或密码不正确" }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set("moji_session", signSession(user.email), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: body.remember ? 60 * 60 * 24 * 30 : 60 * 60 * 24 * 7,
  });
  return res;
}
