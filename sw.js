"use strict";

const MODEL_PREFIX = "/drive-model/";
const MAX_CHUNK_SIZE = 8 * 1024 * 1024;
let accessToken = null;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("message", event => {
  const data = event.data || {};
  if (data.type === "SET_TOKEN" && data.token) {
    accessToken = String(data.token);
  } else if (data.type === "CLEAR_TOKEN") {
    accessToken = null;
  }
});

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.includes(MODEL_PREFIX)) {
    return;
  }

  event.respondWith(handleDriveModelRequest(event.request, url));
});

function parseRange(header, size) {
  if (!header || header.includes(",")) return null;
  let match = /^bytes=(\d+)-(\d*)$/i.exec(header);
  if (match) {
    const start = Number(match[1]);
    const requestedEnd = match[2] ? Number(match[2]) : size - 1;
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(requestedEnd) ||
      start < 0 ||
      start >= size ||
      requestedEnd < start
    ) {
      return { invalid: true };
    }
    const end = Math.min(requestedEnd, start + MAX_CHUNK_SIZE - 1, size - 1);
    return { start, end };
  }

  match = /^bytes=-(\d+)$/i.exec(header);
  if (match) {
    let length = Number(match[1]);
    if (!Number.isFinite(length) || length <= 0) return { invalid: true };
    length = Math.min(length, MAX_CHUNK_SIZE, size);
    return { start: size - length, end: size - 1 };
  }

  return null;
}

function syntheticHeaders(size, contentType = "application/octet-stream") {
  return {
    "Accept-Ranges": "bytes",
    "Content-Length": String(size),
    "Content-Type": contentType,
    "Cache-Control": "no-store"
  };
}

async function handleDriveModelRequest(request, url) {
  if (!accessToken) {
    return new Response("Google Drive authorization required", { status: 401 });
  }

  const marker = url.pathname.lastIndexOf(MODEL_PREFIX);
  const encodedId = url.pathname.substring(marker + MODEL_PREFIX.length);
  const fileId = decodeURIComponent(encodedId || "");
  const size = Number(url.searchParams.get("size"));

  if (!fileId || !Number.isFinite(size) || size <= 0) {
    return new Response("Missing file ID or size", { status: 400 });
  }

  if (request.method === "HEAD") {
    return new Response(null, { status: 200, headers: syntheticHeaders(size) });
  }

  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const range = parseRange(request.headers.get("Range"), size);
  if (!range) {
    return new Response("Range header required for model files", {
      status: 428,
      headers: { "Accept-Ranges": "bytes", "Cache-Control": "no-store" }
    });
  }
  if (range.invalid) {
    return new Response(null, {
      status: 416,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Range": "bytes */" + size,
        "Cache-Control": "no-store"
      }
    });
  }

  const headers = new Headers();
  headers.set("Authorization", "Bearer " + accessToken);
  headers.set("Range", "bytes=" + range.start + "-" + range.end);

  const resourceKey = url.searchParams.get("resourceKey");
  if (resourceKey) {
    headers.set("X-Goog-Drive-Resource-Keys", fileId + "/" + resourceKey);
  }

  const driveUrl =
    "https://www.googleapis.com/drive/v3/files/" +
    encodeURIComponent(fileId) +
    "?alt=media&supportsAllDrives=true";

  let upstream;
  try {
    upstream = await fetch(driveUrl, {
      method: "GET",
      headers,
      cache: "no-store",
      signal: request.signal
    });
  } catch (error) {
    return new Response("Drive request failed: " + error.message, { status: 502 });
  }

  if (upstream.status !== 206) {
    try {
      if (upstream.body) await upstream.body.cancel();
    } catch (_) {}
    return new Response("Drive did not honor byte Range", { status: 502 });
  }

  const out = new Headers(upstream.headers);
  out.delete("Content-Disposition");
  out.set("Accept-Ranges", "bytes");
  out.set("Cache-Control", "no-store");
  if (!out.get("Content-Type")) out.set("Content-Type", "application/octet-stream");

  return new Response(upstream.body, {
    status: 206,
    headers: out
  });
}
