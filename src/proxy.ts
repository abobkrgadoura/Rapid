import { NextResponse, type NextRequest } from "next/server";

import { fetchSessionProfile } from "@/lib/auth/profile";
import {
  REQUEST_PATHNAME_HEADER,
  loginPathFor,
  roleForPath,
  safeNextPath,
} from "@/lib/auth/roles";
import { updateSession } from "@/utils/supabase/middleware";

function redirectWithSession(sessionResponse: NextResponse, url: URL) {
  const redirectResponse = NextResponse.redirect(url, 303);
  sessionResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  redirectResponse.headers.set(
    "Cache-Control",
    "private, no-cache, no-store, must-revalidate, max-age=0",
  );
  return redirectResponse;
}

/**
 * Refreshes the Supabase session, then applies the role gate.
 * Layouts call requireRole again; this redirect is the early deny.
 */
export async function proxy(request: NextRequest) {
  request.headers.set(REQUEST_PATHNAME_HEADER, request.nextUrl.pathname);

  const { supabase, response, userId } = await updateSession(request);
  const { pathname, search } = request.nextUrl;
  const requiredRole = roleForPath(pathname);
  const authEntry = pathname === "/login" || pathname === "/register";
  const needsRole = requiredRole !== null || authEntry;
  const profile =
    userId && needsRole ? await fetchSessionProfile(supabase, userId) : null;

  if (!userId) {
    if (requiredRole) {
      const url = new URL(loginPathFor(`${pathname}${search}`), request.url);
      return redirectWithSession(response, url);
    }
    return response;
  }

  if (authEntry) {
    const destination = profile
      ? safeNextPath(request.nextUrl.searchParams.get("next"), profile.role)
      : "/unauthorized";
    return redirectWithSession(response, new URL(destination, request.url));
  }

  if (requiredRole && profile?.role !== requiredRole) {
    return redirectWithSession(response, new URL("/unauthorized", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
