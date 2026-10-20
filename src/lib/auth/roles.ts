/**
 * App roles match public.user_role. The JWT `role` claim is the Postgres
 * role (`authenticated`) and user_metadata.role is caller-supplied, so neither
 * is an authorization source.
 */
export const APP_ROLES = ["admin", "merchant", "driver", "customer"] as const;

export type AppRole = (typeof APP_ROLES)[number];

export const ROLE_HOME: Record<AppRole, string> = {
  admin: "/admin",
  merchant: "/merchant",
  driver: "/driver",
  customer: "/customer",
};

/** Forwarded by the proxy so layouts can rebuild the login return path. */
export const REQUEST_PATHNAME_HEADER = "x-rapid-pathname";

const ROLE_PREFIXES: ReadonlyArray<{ prefix: string; role: AppRole }> = [
  { prefix: "/admin", role: "admin" },
  { prefix: "/merchant", role: "merchant" },
  { prefix: "/driver", role: "driver" },
  { prefix: "/customer", role: "customer" },
];

export function isAppRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

export function homeForRole(role: AppRole): string {
  return ROLE_HOME[role];
}

/** Role required by a pathname, or null when the path is not a role surface. */
export function roleForPath(pathname: string): AppRole | null {
  for (const entry of ROLE_PREFIXES) {
    if (pathname === entry.prefix || pathname.startsWith(`${entry.prefix}/`)) {
      return entry.role;
    }
  }
  return null;
}

/**
 * Collapse a candidate return path to a same-origin route.
 * Rejects protocol-relative URLs, backslashes, encoding tricks, and `..`.
 */
function normalizeAppPath(input: string): string | null {
  let decoded = input;
  try {
    decoded = decodeURIComponent(input);
  } catch {
    return null;
  }

  if (
    decoded.includes("%") ||
    decoded.includes("\\") ||
    decoded.includes("://") ||
    !decoded.startsWith("/") ||
    decoded.startsWith("//")
  ) {
    return null;
  }

  const splitAt = decoded.search(/[?#]/);
  const suffix = splitAt === -1 ? "" : decoded.slice(splitAt);
  const pathname = splitAt === -1 ? decoded : decoded.slice(0, splitAt);
  const parts: string[] = [];

  for (const part of pathname.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") return null;
    parts.push(part);
  }

  return `/${parts.join("/")}${suffix}`;
}

/**
 * Post-login destination. Only a same-origin path that belongs to this role
 * is honored. Anything else, including an open redirect, falls back to the
 * role home.
 */
export function safeNextPath(
  next: string | null | undefined,
  role: AppRole,
): string {
  const home = homeForRole(role);
  if (!next) return home;

  const normalized = normalizeAppPath(next);
  if (!normalized) return home;

  const pathname = normalized.split(/[?#]/, 1)[0] ?? "";
  if (roleForPath(pathname) !== role) return home;
  return normalized;
}

/** Login URL that returns the user to a same-origin path after they sign in. */
export function loginPathFor(pathname: string | null | undefined): string {
  if (!pathname) return "/login";
  const normalized = normalizeAppPath(pathname);
  if (!normalized) return "/login";
  const pathOnly = normalized.split(/[?#]/, 1)[0] ?? "";
  if (!roleForPath(pathOnly)) return "/login";
  return `/login?next=${encodeURIComponent(normalized)}`;
}
