import assert from "node:assert/strict";
import test from "node:test";
import { isModerationProbeEnabled } from "./route-access";

test("enables the moderation probe for local development and Vercel previews", () => {
  assert.equal(
    isModerationProbeEnabled({
      nodeEnv: "development",
      vercelEnv: undefined,
    }),
    true,
  );
  assert.equal(
    isModerationProbeEnabled({
      nodeEnv: "production",
      vercelEnv: "preview",
    }),
    true,
  );
});

test("disables the moderation probe in every production environment", () => {
  assert.equal(
    isModerationProbeEnabled({
      nodeEnv: "production",
      vercelEnv: "production",
    }),
    false,
  );
  assert.equal(
    isModerationProbeEnabled({
      nodeEnv: "production",
      vercelEnv: undefined,
    }),
    false,
  );
});
