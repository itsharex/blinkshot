// Server-side origin guard — defense in depth against naive direct curl/bot
// calls that bypass the browser. This is NOT a real lock: every header here is
// trivially spoofable (`curl -H "Origin: ..."`). It stops unsophisticated
// clients (no Origin / Referer / Sec-Fetch-Site), not a determined attacker.
// The server-side prompt stop-words remain the actual safeguard and work
// regardless of who calls. Pure and header-value driven so it is unit-testable
// without spinning up the server.

export type OriginGuardInput = {
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  allowedOrigins: ReadonlySet<string>;
  // The URL Vercel resolved for this request. Its origin covers custom domains
  // without requiring a separately configured allowlist entry.
  requestUrl?: string;
  // When true, any http(s)://localhost or 127.0.0.1 origin is accepted.
  // Harmless in production (no real traffic carries a localhost origin) and
  // keeps local dev from breaking on arbitrary ports.
  allowLocalhost?: boolean;
};

export function isAllowedOrigin({
  origin,
  referer,
  secFetchSite,
  allowedOrigins,
  requestUrl,
  allowLocalhost = false,
}: OriginGuardInput): boolean {
  // Modern browsers send Sec-Fetch-Site: same-origin for the app's own
  // same-origin fetches. A cross-origin browser request sends cross-site /
  // same-site, never same-origin — so this is a reliable positive signal.
  // (Spoofable by non-browsers, which is the expected speed-bump tradeoff.)
  if (secFetchSite === "same-origin") {
    return true;
  }

  const requestOrigin = requestUrl === undefined ? null : originOf(requestUrl);

  if (
    origin !== null &&
    isAllowedOriginValue(
      origin,
      allowedOrigins,
      requestOrigin,
      allowLocalhost,
    )
  ) {
    return true;
  }

  const refererOrigin = referer === null ? null : originOf(referer);
  if (
    refererOrigin !== null &&
    isAllowedOriginValue(
      refererOrigin,
      allowedOrigins,
      requestOrigin,
      allowLocalhost,
    )
  ) {
    return true;
  }

  return false;
}

function isAllowedOriginValue(
  value: string,
  allowed: ReadonlySet<string>,
  requestOrigin: string | null,
  allowLocalhost: boolean,
): boolean {
  if (value === requestOrigin || allowed.has(value)) {
    return true;
  }
  if (allowLocalhost && isLocalhostOrigin(value)) {
    return true;
  }
  return false;
}

// Extract the origin (scheme://host[:port]) from a URL-like string, or null
// if the value cannot be parsed as a URL.
export function originOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return null;
  }
}

function isLocalhostOrigin(origin: string): boolean {
  const parsed = originOf(origin);
  if (parsed === null) return false;
  try {
    return (
      new URL(parsed).hostname === "localhost" ||
      new URL(parsed).hostname === "127.0.0.1"
    );
  } catch {
    return false;
  }
}
