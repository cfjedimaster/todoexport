import test from "node:test";
import assert from "node:assert/strict";
import handler, { config } from "../netlify/functions/config.mts";

test("config function exports /api/config GET route", () => {
  assert.equal(config.path, "/api/config");
  assert.equal(config.method, "GET");
});

test("config function returns MS_CLIENT_ID with no-store cache header", async () => {
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = {
    env: {
      get(key) {
        return key === "MS_CLIENT_ID" ? "12345678-abcd-ef00-1234-567890abcdef" : undefined;
      },
    },
  };

  try {
    const res = await handler(new Request("https://example.com/api/config"), {});
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), {
      clientId: "12345678-abcd-ef00-1234-567890abcdef",
    });
  } finally {
    globalThis.Netlify = originalNetlify;
  }
});

test("config function returns 500 when MS_CLIENT_ID is missing", async () => {
  const originalNetlify = globalThis.Netlify;
  globalThis.Netlify = {
    env: {
      get() {
        return undefined;
      },
    },
  };

  try {
    const res = await handler(new Request("https://example.com/api/config"), {});
    assert.equal(res.status, 500);
    assert.equal(res.headers.get("cache-control"), "no-store");
    const body = await res.json();
    assert.match(body.error, /MS_CLIENT_ID/);
  } finally {
    globalThis.Netlify = originalNetlify;
  }
});
