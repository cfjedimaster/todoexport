const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPES = ["openid", "profile", "https://graph.microsoft.com/Tasks.Read"];

const STORAGE_KEYS = {
  pkce: "todoexport.pkce",
  session: "todoexport.session",
};

/**
 * Encode raw bytes to URL-safe base64 without padding.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function base64UrlEncode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

/**
 * Decode a URL-safe base64 string into a UTF-8 string.
 * @param {string} input
 * @returns {string}
 */
export function base64UrlDecodeToString(input) {
  const padded = input.replaceAll("-", "+").replaceAll("_", "/").padEnd(
    input.length + ((4 - (input.length % 4)) % 4),
    "="
  );
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Generate a cryptographically random URL-safe string.
 * @param {number} byteLength
 * @returns {string}
 */
export function generateRandomString(byteLength = 48) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

/**
 * Derive an S256 PKCE code_challenge from a code_verifier.
 * @param {string} verifier
 * @returns {Promise<string>}
 */
export async function generateCodeChallenge(verifier) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return base64UrlEncode(new Uint8Array(digest));
}

/**
 * Parse OAuth parameters returned in a URL hash fragment (e.g. "#code=...&state=...").
 * @param {string} hash
 * @returns {Record<string, string>}
 */
export function parseFragmentParams(hash) {
  const cleaned = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!cleaned) {
    return {};
  }
  const params = new URLSearchParams(cleaned);
  return Object.fromEntries(params.entries());
}

/**
 * Decode the payload segment of a JWT (such as an ID token) without verifying signature.
 * @param {string | undefined} jwt
 * @returns {Record<string, unknown> | null}
 */
export function decodeJwtPayload(jwt) {
  if (!jwt || typeof jwt !== "string") {
    return null;
  }
  const parts = jwt.split(".");
  if (parts.length < 2) {
    return null;
  }
  try {
    return JSON.parse(base64UrlDecodeToString(parts[1]));
  } catch {
    return null;
  }
}

/**
 * Normalized redirect URI (origin + trailing slash) so Entra ID matches cleanly.
 * @returns {string}
 */
export function getRedirectUri() {
  return `${window.location.origin}/`;
}

/**
 * Load public configuration (Microsoft client ID) from the server endpoint.
 * @returns {Promise<{ clientId: string }>}
 */
export async function loadAppConfig() {
  const response = await fetch("/api/config", {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.clientId) {
    throw new Error(
      payload?.error || "Unable to load sign-in configuration. Please try again later."
    );
  }

  return { clientId: String(payload.clientId) };
}

/**
 * Begin the Microsoft sign-in redirect flow.
 * @param {string} clientId
 */
export async function startLogin(clientId) {
  const codeVerifier = generateRandomString(64);
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomString(32);

  sessionStorage.setItem(
    STORAGE_KEYS.pkce,
    JSON.stringify({ codeVerifier, state })
  );

  const authorizeUrl = new URL(`${AUTHORITY}/authorize`);
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri());
  authorizeUrl.searchParams.set("response_mode", "fragment");
  authorizeUrl.searchParams.set("scope", SCOPES.join(" "));
  authorizeUrl.searchParams.set("code_challenge", codeChallenge);
  authorizeUrl.searchParams.set("code_challenge_method", "S256");
  authorizeUrl.searchParams.set("state", state);
  authorizeUrl.searchParams.set("prompt", "select_account");

  window.location.assign(authorizeUrl.toString());
}

/**
 * Read any valid (unexpired) session from sessionStorage.
 * @returns {{ accessToken: string, expiresAt: number, user: { name: string, email: string } } | null}
 */
export function getStoredSession() {
  const raw = sessionStorage.getItem(STORAGE_KEYS.session);
  if (!raw) {
    return null;
  }

  try {
    const session = JSON.parse(raw);
    if (!session?.accessToken || !session?.expiresAt) {
      clearSession();
      return null;
    }
    // Treat tokens expiring within 30 seconds as expired
    if (Date.now() >= session.expiresAt - 30_000) {
      clearSession();
      return null;
    }
    return session;
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Clear stored tokens and PKCE state.
 */
export function clearSession() {
  sessionStorage.removeItem(STORAGE_KEYS.session);
  sessionStorage.removeItem(STORAGE_KEYS.pkce);
}

/**
 * If returning from Microsoft sign-in, validate state and exchange the authorization code for a token.
 * @param {string} clientId
 * @returns {Promise<{ accessToken: string, expiresAt: number, user: { name: string, email: string } } | null>}
 */
export async function handleAuthCallback(clientId) {
  const fragment = parseFragmentParams(window.location.hash);
  if (!fragment.code && !fragment.error) {
    return null;
  }

  // Strip sensitive callback parameters from the browser address bar right away
  window.history.replaceState(
    null,
    document.title,
    `${window.location.pathname}${window.location.search}`
  );

  if (fragment.error) {
    sessionStorage.removeItem(STORAGE_KEYS.pkce);
    if (fragment.error === "access_denied") {
      throw new Error("Sign-in was canceled before granting read-only access.");
    }
    throw new Error(
      fragment.error_description || `Sign-in failed (${fragment.error}). Please try again.`
    );
  }

  const storedPkceRaw = sessionStorage.getItem(STORAGE_KEYS.pkce);
  sessionStorage.removeItem(STORAGE_KEYS.pkce);

  if (!storedPkceRaw) {
    throw new Error("Sign-in session expired. Please click Sign in with Microsoft again.");
  }

  let storedPkce;
  try {
    storedPkce = JSON.parse(storedPkceRaw);
  } catch {
    throw new Error("Sign-in state was corrupted. Please try signing in again.");
  }

  if (!fragment.state || fragment.state !== storedPkce.state) {
    throw new Error("Sign-in security check failed. Please try signing in again.");
  }

  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: "authorization_code",
    code: fragment.code,
    redirect_uri: getRedirectUri(),
    code_verifier: storedPkce.codeVerifier,
    scope: SCOPES.join(" "),
  });

  const tokenResponse = await fetch(`${AUTHORITY}/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });

  let tokenData = null;
  try {
    tokenData = await tokenResponse.json();
  } catch {
    tokenData = null;
  }

  if (!tokenResponse.ok || !tokenData?.access_token) {
    throw new Error(
      tokenData?.error_description ||
        "Could not complete sign-in with Microsoft. Please try again."
    );
  }

  const claims = decodeJwtPayload(tokenData.id_token);
  const name =
    (typeof claims?.name === "string" && claims.name) ||
    (typeof claims?.preferred_username === "string" && claims.preferred_username) ||
    "Microsoft Account";
  const email =
    (typeof claims?.preferred_username === "string" && claims.preferred_username) ||
    (typeof claims?.email === "string" && claims.email) ||
    (typeof claims?.upn === "string" && claims.upn) ||
    "";

  const expiresInSeconds = Number(tokenData.expires_in) || 3600;
  const session = {
    accessToken: tokenData.access_token,
    expiresAt: Date.now() + expiresInSeconds * 1000,
    user: { name, email },
  };

  sessionStorage.setItem(STORAGE_KEYS.session, JSON.stringify(session));
  return session;
}
