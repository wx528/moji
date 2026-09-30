import { NextResponse } from "next/server";

export function middleware(req) {
  const hasSession = req.cookies.get("moji_session")?.value;
  if (!hasSession) {
    return NextResponse.redirect(new URL("/", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/editor", "/shelf"],
};
