import { NextResponse, type NextRequest } from "next/server";
import { Role } from "@prisma/client";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";

export async function proxy(request: NextRequest) {
  const session = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const path = request.nextUrl.pathname;
  const denied = !session || (path.startsWith("/admin") && session.role !== Role.ADMIN) || (path.startsWith("/examiner") && session.role !== Role.ADMIN && session.role !== Role.EXAMINER) || ((path.startsWith("/dashboard") || path.startsWith("/exam/") || path.startsWith("/results/")) && session.role !== Role.CANDIDATE);
  if (denied) return NextResponse.redirect(new URL("/login", request.url));
  return NextResponse.next();
}

export const config = { matcher: ["/admin/:path*", "/examiner/:path*", "/dashboard/:path*", "/exam/:path*", "/results/:path*"] };
