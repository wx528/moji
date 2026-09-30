import { NextResponse } from "next/server";
import { verifySession, findUser } from "@/lib/auth";

export async function GET(req) {
  const token = req.cookies.get("moji_session")?.value;
  const email = verifySession(token);
  if (!email) {
    return NextResponse.json({ error: "未登录" }, { status: 401 });
  }
  const user = findUser(email);
  if (!user) {
    return NextResponse.json({ error: "用户不存在" }, { status: 401 });
  }
  return NextResponse.json({ email: user.email, name: user.name });
}
