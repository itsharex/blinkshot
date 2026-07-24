import assert from "node:assert/strict";
import test from "node:test";
import { isAllowedOrigin, originOf } from "./origin-guard";

const allowed = new Set([
  "https://blinkshot.example",
  "http://localhost:3000",
]);

test("allows a same-origin browser request (Origin matches)", () => {
  assert.equal(
    isAllowedOrigin({
      origin: "https://blinkshot.example",
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
    }),
    true,
  );
});

test("allows when Referer origin matches and Origin is absent", () => {
  assert.equal(
    isAllowedOrigin({
      origin: null,
      referer: "https://blinkshot.example/some/page",
      secFetchSite: null,
      allowedOrigins: allowed,
    }),
    true,
  );
});

test("allows Origin and Referer matching the actual request URL", () => {
  assert.equal(
    isAllowedOrigin({
      origin: "https://www.blinkshot.io",
      referer: "https://www.blinkshot.io/",
      secFetchSite: null,
      allowedOrigins: new Set(["https://blinkshot-deployment.vercel.app"]),
      requestUrl: "https://www.blinkshot.io/api/generateImages",
    }),
    true,
  );
});

test("allows via Sec-Fetch-Site: same-origin with no Origin/Referer", () => {
  assert.equal(
    isAllowedOrigin({
      origin: null,
      referer: null,
      secFetchSite: "same-origin",
      allowedOrigins: allowed,
    }),
    true,
  );
});

test("rejects a naive curl (no Origin / Referer / Sec-Fetch-Site)", () => {
  assert.equal(
    isAllowedOrigin({
      origin: null,
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
    }),
    false,
  );
});

test("rejects a cross-origin Origin", () => {
  assert.equal(
    isAllowedOrigin({
      origin: "https://evil.example",
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
      requestUrl: "https://blinkshot.example/api/generateImages",
    }),
    false,
  );
});

test("rejects when Sec-Fetch-Site is cross-site and no matching Origin/Referer", () => {
  assert.equal(
    isAllowedOrigin({
      origin: null,
      referer: null,
      secFetchSite: "cross-site",
      allowedOrigins: allowed,
    }),
    false,
  );
});

test("allowLocalhost accepts any localhost / 127.0.0.1 port", () => {
  assert.equal(
    isAllowedOrigin({
      origin: "http://localhost:5173",
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
      allowLocalhost: true,
    }),
    true,
  );
  assert.equal(
    isAllowedOrigin({
      origin: "http://127.0.0.1:3001",
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
      allowLocalhost: true,
    }),
    true,
  );
  // Without the flag, a localhost port not in the explicit set is rejected.
  assert.equal(
    isAllowedOrigin({
      origin: "http://localhost:5173",
      referer: null,
      secFetchSite: null,
      allowedOrigins: allowed,
      allowLocalhost: false,
    }),
    false,
  );
});

test("originOf extracts scheme://host[:port], or null for non-URLs", () => {
  assert.equal(
    originOf("https://blinkshot.example/some/page?x=1"),
    "https://blinkshot.example",
  );
  assert.equal(originOf("http://localhost:3000/x"), "http://localhost:3000");
  assert.equal(originOf("not a url"), null);
});
