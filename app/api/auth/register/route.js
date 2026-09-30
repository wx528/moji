import { NextResponse } from "next/server";
import { createUser, signSession } from "@/lib/auth";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求格式错误" }, { status: 400 });
  }

  const email = (body.email ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim() || email.split("@")[0];
  const password = body.password ?? "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "邮箱格式不正确" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json(
      { error: "密码至少需要 6 位字符" },
      { status: 400 }
    );
  }

  const user = createUser({ email, name, password });
  if (!user) {
    return NextResponse.json({ error: "该邮箱已被注册" }, { status: 409 });
  }

  const res = NextResponse.json({ ok: true, name: user.name });
  res.cookies.set("moji_session", signSession(user.email), {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
