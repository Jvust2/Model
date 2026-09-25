const DEFAULT_RETURN_URL =
  "https://jvust.github.io/drive-original-player/";

const ALLOWED_RETURN_URLS = new Set([
  "https://jvust.github.io/drive-original-player/",
  "https://jvust2.github.io/Model/"
]);

const ALLOWED_ORIGINS = new Set([
  "https://jvust.github.io",
  "https://jvust2.github.io"
]);

const SCOPES = [
  "https://www.googleapis.com/auth/drive.readonly",
  "https://www.googleapis.com/auth/drive.install"
].join(" ");

const STATE_TTL_SECONDS = 600;
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return handleOptions(request);
    }

    if (url.pathname === "/") {
      return new Response("Drive OAuth Bridge is running.", {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Cache-Control": "no-store"
        }
      });
    }

    if (url.pathname === "/auth") {
      return startAuthorization(url, env);
    }

    if (url.pathname === "/callback") {
      return handleCallback(url, env);
    }

    if (url.pathname === "/token") {
      return getAccessToken(request, env);
    }

    return new Response("Not Found", { status: 404 });
  }
};

async function startAuthorization(url, env) {
  const requestedReturnTo =
    url.searchParams.get("return_to") || DEFAULT_RETURN_URL;

  const returnTo = normalizeReturnTo(requestedReturnTo);
  if (!returnTo) {
    return new Response("Invalid return_to.", {
      status: 400,
      headers: { "Cache-Control": "no-store" }
    });
  }

  const state = randomString(32);

  await env.OAUTH_KV.put(
    "oauth_state:" + state,
    JSON.stringify({ returnTo }),
    { expirationTtl: STATE_TTL_SECONDS }
  );

  const authUrl = new URL(
    "https://accounts.google.com/o/oauth2/v2/auth"
  );

  authUrl.searchParams.set("client_id", env.GOOGLE_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", env.REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");
  authUrl.searchParams.set("include_granted_scopes", "true");
  authUrl.searchParams.set("state", state);

  return Response.redirect(authUrl.toString(), 302);
}

async function handleCallback(url, env) {
  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    return new Response("Google OAuth failed: " + oauthError, {
      status: 400
    });
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!code || !state) {
    return new Response("Missing OAuth code or state.", {
      status: 400
    });
  }

  const stateRecordRaw = await env.OAUTH_KV.get(
    "oauth_state:" + state
  );

  if (!stateRecordRaw) {
    return new Response("Invalid or expired OAuth state.", {
      status: 400
    });
  }

  await env.OAUTH_KV.delete("oauth_state:" + state);

  let returnTo = DEFAULT_RETURN_URL;
  try {
    const record = JSON.parse(stateRecordRaw);
    const candidate = normalizeReturnTo(record.returnTo);
    if (candidate) returnTo = candidate;
  } catch (_) {
    // Backward compatibility for an old "1" state record.
  }

  const body = new URLSearchParams();
  body.set("code", code);
  body.set("client_id", env.GOOGLE_CLIENT_ID);
  body.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  body.set("redirect_uri", env.REDIRECT_URI);
  body.set("grant_type", "authorization_code");

  const tokenResponse = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    }
  );

  const tokenData = await tokenResponse.json();

  if (!tokenResponse.ok) {
    console.error("Google token exchange failed", tokenData);
    return new Response("Google token exchange failed.", {
      status: 500
    });
  }

  if (tokenData.refresh_token) {
    await env.OAUTH_KV.put(
      "refresh_token",
      tokenData.refresh_token
    );
  } else {
    const existing = await env.OAUTH_KV.get("refresh_token");
    if (!existing) {
      return new Response(
        "No refresh token received. Please authorize again.",
        { status: 500 }
      );
    }
  }

  const sessionSecret = randomString(32);
  const sessionHash = await sha256Hex(sessionSecret);
  const returnOrigin = new URL(returnTo).origin;

  await env.OAUTH_KV.put(
    "session:" + sessionHash,
    JSON.stringify({ origin: returnOrigin }),
    { expirationTtl: SESSION_TTL_SECONDS }
  );

  const separator = returnTo.includes("#") ? "&" : "#";
  const returnUrl =
    returnTo +
    separator +
    "oauth_session=" +
    encodeURIComponent(sessionSecret);

  return new Response(null, {
    status: 302,
    headers: {
      Location: returnUrl,
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer"
    }
  });
}

async function getAccessToken(request, env) {
  const origin = request.headers.get("Origin");
  const cors = corsHeaders(origin);

  if (!isAllowedOrigin(origin)) {
    return json(
      { error: "origin_not_allowed" },
      403,
      cors
    );
  }

  const authorization =
    request.headers.get("Authorization") || "";

  if (!authorization.startsWith("Bearer ")) {
    return json(
      { error: "missing_session" },
      401,
      cors
    );
  }

  const sessionSecret = authorization.slice(7);
  const suppliedHash = await sha256Hex(sessionSecret);

  const sessionRaw = await env.OAUTH_KV.get(
    "session:" + suppliedHash
  );

  if (!sessionRaw) {
    return json(
      { error: "invalid_session" },
      401,
      cors
    );
  }

  try {
    const session = JSON.parse(sessionRaw);
    if (session.origin !== origin) {
      return json(
        { error: "session_origin_mismatch" },
        403,
        cors
      );
    }
  } catch (_) {
    return json(
      { error: "invalid_session" },
      401,
      cors
    );
  }

  const refreshToken = await env.OAUTH_KV.get(
    "refresh_token"
  );

  if (!refreshToken) {
    return json(
      { error: "authorization_required" },
      401,
      cors
    );
  }

  const body = new URLSearchParams();
  body.set("client_id", env.GOOGLE_CLIENT_ID);
  body.set("client_secret", env.GOOGLE_CLIENT_SECRET);
  body.set("refresh_token", refreshToken);
  body.set("grant_type", "refresh_token");

  const response = await fetch(
    "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    }
  );

  const data = await response.json();

  if (!response.ok) {
    console.error("Refresh token failed", data);
    return json(
      {
        error: "refresh_failed",
        reauthorize: true
      },
      401,
      cors
    );
  }

  return json(
    {
      access_token: data.access_token,
      expires_in: data.expires_in,
      token_type: data.token_type || "Bearer"
    },
    200,
    cors
  );
}

function handleOptions(request) {
  const origin = request.headers.get("Origin");

  if (!isAllowedOrigin(origin)) {
    return new Response(null, { status: 403 });
  }

  return new Response(null, {
    status: 204,
    headers: corsHeaders(origin)
  });
}

function corsHeaders(origin) {
  const headers = {
    "Cache-Control": "no-store",
    Vary: "Origin",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type",
    "Access-Control-Allow-Methods":
      "GET, OPTIONS"
  };

  if (isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  return headers;
}

function isAllowedOrigin(origin) {
  return Boolean(origin && ALLOWED_ORIGINS.has(origin));
}

function normalizeReturnTo(value) {
  try {
    const url = new URL(String(value || ""));
    url.search = "";
    url.hash = "";

    const normalized = url.toString();
    return ALLOWED_RETURN_URLS.has(normalized)
      ? normalized
      : null;
  } catch (_) {
    return null;
  }
}

function json(data, status, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      ...extraHeaders
    }
  });
}

function randomString(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);

  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    data
  );

  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
