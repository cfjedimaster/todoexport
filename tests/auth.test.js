import test from "node:test";
import assert from "node:assert/strict";
import {
  base64UrlEncode,
  decodeJwtPayload,
  generateCodeChallenge,
  generateRandomString,
  parseFragmentParams,
} from "../public/js/auth.js";

test("generateCodeChallenge matches RFC 7636 Appendix B test vector", async () => {
  const verifier = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
  const expected = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";
  const challenge = await generateCodeChallenge(verifier);
  assert.equal(challenge, expected);
});

test("generateRandomString produces URL-safe unpadded tokens", () => {
  const value = generateRandomString(48);
  assert.equal(value.length, 64);
  assert.match(value, /^[A-Za-z0-9_-]+$/);
});

test("parseFragmentParams parses hash fragments cleanly", () => {
  assert.deepEqual(parseFragmentParams(""), {});
  assert.deepEqual(parseFragmentParams("#"), {});
  assert.deepEqual(parseFragmentParams("#code=abc123&state=xyz789"), {
    code: "abc123",
    state: "xyz789",
  });
  assert.deepEqual(
    parseFragmentParams("#error=access_denied&error_description=User%20canceled"),
    {
      error: "access_denied",
      error_description: "User canceled",
    }
  );
});

test("decodeJwtPayload decodes UTF-8 claims safely and rejects malformed tokens", () => {
  const header = base64UrlEncode(new TextEncoder().encode(JSON.stringify({ alg: "RS256" })));
  const payload = base64UrlEncode(
    new TextEncoder().encode(
      JSON.stringify({ name: "Renée Camden", preferred_username: "renee@example.com" })
    )
  );
  const fakeJwt = `${header}.${payload}.signature`;

  assert.deepEqual(decodeJwtPayload(fakeJwt), {
    name: "Renée Camden",
    preferred_username: "renee@example.com",
  });
  assert.equal(decodeJwtPayload("not-a-jwt"), null);
  assert.equal(decodeJwtPayload(undefined), null);
});
