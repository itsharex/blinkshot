import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  MIN_PROMPT_LENGTH,
  SHARED_BLOCKED_TERMS,
  isPromptTooShort,
  tokenizePrompt,
  validatePromptShared,
} from "./prompt-validation";
// Imports the server-only module. The `react-server` export condition
// (set in the `test` script) resolves `server-only` to its no-op entry so the
// CSAM-term validator is importable under the Node test runner.
import { describePromptRejection, validatePrompt } from "./prompt-validation.server";

// prompt-validation.fixtures.json is gitignored — it holds the real abuse
// prompts (CSAM / NSFW) used to regression-test the blocklist. No sensitive
// text is committed in this repo; the tests below that need real abuse prompts
// SKIP when the file is absent (fresh clone / CI), so the benign + structural
// tests still run everywhere. Loaded with a computed path so the bundler can't
// statically resolve (and fail on) the file. Pattern mirrors
// lib/moderation/inference.test.ts + reference_scores.json.
const fixturesPath = path.join(__dirname, "prompt-validation.fixtures.json");
type Fixtures = {
  sharedToken: string;
  serverToken: string;
  sharedBlocked: string[];
  substringNonMatch: string[];
  serverBlockedClientAllows: string[];
  serverBlocked: string[];
  agePhraseBlocked: string[];
  agePhraseNonHumanFP: string[];
  tweenBlocked: string[];
  newSharedBlocked: string[];
  sexyCurvyAllowed: string[];
  sexyCurvyBlocked: string[];
  geologyFp: string[];
  nonEnglishBlocked: string[];
  nonEnglishBenign: string[];
};
let FX: Fixtures | null = null;
if (existsSync(fixturesPath)) {
  try {
    FX = JSON.parse(readFileSync(fixturesPath, "utf-8")) as Fixtures;
  } catch {
    FX = null;
  }
}

// --- length gate (benign) ---

test("rejects prompts shorter than the minimum length", () => {
  for (const prompt of ["", "   ", "a", "ab"]) {
    assert.equal(isPromptTooShort(prompt), true);
    assert.deepEqual(validatePromptShared(prompt), {
      ok: false,
      reason: "too_short",
    });
    assert.deepEqual(validatePrompt(prompt), { ok: false, reason: "too_short" });
  }
});

test("accepts a prompt exactly at the minimum length boundary", () => {
  const boundary = "a".repeat(MIN_PROMPT_LENGTH); // "aaa"
  assert.equal(isPromptTooShort(boundary), false);
  assert.deepEqual(validatePromptShared(boundary), { ok: true });
  assert.deepEqual(validatePrompt(boundary), { ok: true });
});

// --- shared blocked terms (real abuse prompts from gitignored fixtures) ---

test("blocks shared NSFW terms case-insensitively and reports the shared tier", { skip: !FX }, () => {
  for (const prompt of FX!.sharedBlocked) {
    assert.deepEqual(validatePromptShared(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "shared",
    });
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "shared",
    });
  }
});

test("does not match blocked terms as substrings inside other words", { skip: !FX }, () => {
  // Word-boundary tokens: a benign word that merely contains a blocked
  // substring (see the gitignored fixtures) is NOT matched.
  for (const prompt of FX!.substringNonMatch) {
    assert.deepEqual(validatePromptShared(prompt), { ok: true });
  }
});

// --- server-only CSAM terms: only the server validator catches them ---

test("the shared (client) validator does NOT see server-only CSAM terms", { skip: !FX }, () => {
  for (const prompt of FX!.serverBlockedClientAllows) {
    assert.deepEqual(validatePromptShared(prompt), { ok: true });
  }
});

test("the server validator blocks CSAM terms and reports the server tier", { skip: !FX }, () => {
  for (const prompt of FX!.serverBlocked) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "server",
    });
  }
});

test("the server validator also catches shared terms (full union)", { skip: !FX }, () => {
  assert.deepEqual(validatePrompt(FX!.sharedBlocked[0]), {
    ok: false,
    reason: "blocked_term",
    tier: "shared",
  });
});

test("the server validator blocks the minor-age euphemism from the 2026-07-21 logs", { skip: !FX }, () => {
  // enguard-8m scored the real prod variants under threshold; the deterministic
  // server blocklist is the reliable catch. The bare euphemism has no shared
  // term co-occurring, so it is caught at the server tier.
  assert.deepEqual(validatePrompt(FX!.tweenBlocked[0]), {
    ok: false,
    reason: "blocked_term",
    tier: "server",
  });
  // The client must not see the server-only term.
  assert.deepEqual(validatePromptShared(FX!.tweenBlocked[0]), { ok: true });
  // The real prod variant is blocked too — now also at the shared tier (an
  // adult-tail term co-occurs), so just assert it is blocked, not the tier.
  assert.equal(validatePrompt(FX!.tweenBlocked[1]).ok, false);
});

test("blocks the 2026-07-21 adult-tail additions at shared tier", { skip: !FX }, () => {
  // The 2026-07-21 low-benign-FP adult-tail additions (see gitignored fixtures).
  for (const prompt of FX!.newSharedBlocked) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "shared",
    });
  }
});

// --- intentional exclusion of ambiguous common words (benign; runs in CI) ---
// These are deliberately NOT in either blocklist. This test documents that
// decision and prevents a naive future regression (e.g. adding "child").

test("allows ambiguous common words that would cause false positives", () => {
  for (const prompt of [
    "a child playing with a kid and a baby at the beach",
    "teenage mutant ninja turtles",
    "a young schoolgirl walking home",
    "a girl riding a horse",
  ]) {
    assert.deepEqual(validatePrompt(prompt), { ok: true });
  }
});

test("keeps borderline adjectives with benign uses allowed (sexy/curvy)", { skip: !FX }, () => {
  // `sexy`/`curvy` are gated by a server-only phrase rule (not a bare block), so
  // benign object uses stay allowed — including the hard cases where a person
  // appears elsewhere in an otherwise-benign prompt ("a sexy sports car with a
  // woman standing next to it", "a curvy road with a girl riding a bike"): the
  // adjective must directly precede a person noun to fire. See gitignored fixtures.
  for (const prompt of FX!.sexyCurvyAllowed) {
    assert.deepEqual(validatePrompt(prompt), { ok: true });
  }
});

test("blocks sexualized adjectives applied to a person or standalone (server tier)", { skip: !FX }, () => {
  // The phrase rule catches `sexy`/`curvy` applied to a person ("a sexy girl") and
  // a standalone adjective (a bare "sexy" has no benign use). All block at the
  // server tier; the client validator does not run this server-only rule. See
  // gitignored fixtures.
  for (const prompt of FX!.sexyCurvyBlocked) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "server",
    });
    assert.deepEqual(validatePromptShared(prompt), { ok: true });
  }
});

test("accepted FP: a benign geology phrase that now blocks", { skip: !FX }, () => {
  // Documents the trade-off of one 2026-07-21 adult-tail addition, which has a
  // benign geology / cell-biology use that now false-positively blocks.
  assert.deepEqual(validatePrompt(FX!.geologyFp[0]), {
    ok: false,
    reason: "blocked_term",
    tier: "shared",
  });
});

test("tokenizePrompt folds Latin diacritics to ASCII (for non-English matching)", () => {
  // Folding is a no-op for plain ASCII; needed so accented non-English abuse
  // tokens match the server-only term set. Benign examples only — the real
  // accented abuse tokens are exercised via the gitignored fixtures below.
  assert.deepEqual(tokenizePrompt("café au lait"), ["cafe", "au", "lait"]);
  assert.deepEqual(tokenizePrompt("naïve Müller"), ["naive", "muller"]);
  assert.deepEqual(tokenizePrompt("Piñata"), ["pinata"]);
});

test("blocks non-English sexual terms at the server tier (client does not see them)", { skip: !FX }, () => {
  // PT / Swahili / DE abuse prompts that returned images in prod (see gitignored
  // fixtures). The enguard-8m model is an English BERT and scores these under
  // threshold, so the deterministic server set is the reliable catch. All are
  // blocked at the server tier; the client validator must let them through —
  // these terms are server-only by design.
  for (const prompt of FX!.nonEnglishBlocked) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "server",
    });
    assert.deepEqual(validatePromptShared(prompt), { ok: true });
  }
});

test("non-English benign text is not blocked (whole-token matching avoids FP)", { skip: !FX }, () => {
  // Real benign non-English prompts from prod: a Portuguese Wikipedia paste
  // (Book of Revelation) and an Italian news-article request whose body contains
  // "continua" — which has "nua" as a substring but is a whole token, so the
  // whole-token match must NOT fire. Locks the non-English false-positive
  // protection alongside the base64 diacritic folding.
  for (const prompt of FX!.nonEnglishBenign) {
    assert.deepEqual(validatePrompt(prompt), { ok: true });
  }
});

test("accepts a benign prompt", () => {
  assert.deepEqual(validatePrompt("A lighthouse by the sea at sunset"), { ok: true });
});

// --- tokenizer unit (benign inputs) ---

test("tokenizes to lowercase word-boundary tokens", () => {
  assert.deepEqual(tokenizePrompt("Bright Pink Apples"), ["bright", "pink", "apples"]);
  assert.deepEqual(tokenizePrompt("Hello, world!"), ["hello", "world"]);
  assert.deepEqual(tokenizePrompt("   "), []);
});

// --- blocklist sanity (specific terms come from gitignored fixtures) ---

test("the shared blocklist holds generic NSFW but no CSAM terms", { skip: !FX }, () => {
  assert.ok(SHARED_BLOCKED_TERMS.size > 0);
  assert.equal(SHARED_BLOCKED_TERMS.has(FX!.sharedToken), true);
  // Server-only CSAM terms must never appear in the client-shipped set.
  assert.equal(SHARED_BLOCKED_TERMS.has(FX!.serverToken), false);
});

// --- age-phrase CSAM rule (server-only) ---

test("server age-phrase rule blocks stated minor ages (digit + word forms)", { skip: !FX }, () => {
  for (const prompt of FX!.agePhraseBlocked) {
    assert.deepEqual(validatePrompt(prompt), {
      ok: false,
      reason: "blocked_term",
      tier: "server",
    });
  }
});

test("age-phrase rule keeps adult ages allowed (the <=17 guard)", () => {
  for (const prompt of [
    "a 30 year old woman hiking",
    "an 18 year old student",
    "a 21 year old man at the beach",
    "a 28 year old programmer",
  ]) {
    assert.deepEqual(validatePrompt(prompt), { ok: true }, "unexpected block");
  }
});

test("the shared (client) validator does NOT run the age-phrase rule", { skip: !FX }, () => {
  // CSAM age detection is server-only by design; the client lets these through
  // and the server rejects them.
  assert.deepEqual(validatePromptShared(FX!.agePhraseBlocked[0]), { ok: true });
});

test("accepted FP: minor-age phrases block even non-human subjects", { skip: !FX }, () => {
  // Traded off for CSAM safety — a minor age is blocked regardless of subject.
  assert.deepEqual(validatePrompt(FX!.agePhraseNonHumanFP[0]), {
    ok: false,
    reason: "blocked_term",
    tier: "server",
  });
});

// --- describePromptRejection: route-facing rejection handling (benign prompts) ---
// Locks the abuse-prevention #1 fix: `too_short` is NOT logged (typing noise +
// easiest flood vector); only `blocked_term` (the abuse signal) is logged. Both
// return the right 400 message. These tests pass benign placeholder prompts +
// the validation object directly, so no sensitive text is committed.

test("describePromptRejection: too_short is not logged and gives the length hint", () => {
  const rejection = describePromptRejection({ ok: false, reason: "too_short" }, "ab");
  assert.equal(rejection.shouldLog, false);
  assert.equal(rejection.message, "Please enter a longer prompt (at least 3 characters).");
  assert.deepEqual(rejection.logMetadata, {
    rejectionReason: "too_short",
    blocklistTier: null,
    promptLength: 2,
  });
});

test("describePromptRejection: a shared-tier blocked_term is logged with tier + length", () => {
  const prompt = "a benign placeholder prompt";
  const rejection = describePromptRejection(
    { ok: false, reason: "blocked_term", tier: "shared" },
    prompt,
  );
  assert.equal(rejection.shouldLog, true);
  assert.equal(rejection.message, "Your prompt contains content that isn't allowed.");
  assert.deepEqual(rejection.logMetadata, {
    rejectionReason: "blocked_term",
    blocklistTier: "shared",
    promptLength: prompt.trim().length,
  });
});

test("describePromptRejection: a server-tier blocked_term reports the server tier", () => {
  const prompt = "another benign placeholder";
  const rejection = describePromptRejection(
    { ok: false, reason: "blocked_term", tier: "server" },
    prompt,
  );
  assert.equal(rejection.shouldLog, true);
  assert.equal(rejection.logMetadata.blocklistTier, "server");
  assert.equal(rejection.logMetadata.promptLength, prompt.trim().length);
});

test("describePromptRejection: end-to-end — a too-short prompt is not logged", () => {
  const prompt = "a";
  const validation = validatePrompt(prompt);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    const rejection = describePromptRejection(validation, prompt);
    assert.equal(rejection.shouldLog, false);
    assert.equal(rejection.message, "Please enter a longer prompt (at least 3 characters).");
  }
});

test("describePromptRejection: end-to-end — a real blocked prompt is logged", { skip: !FX }, () => {
  const prompt = FX!.serverBlocked[2]; // the multi-term CSAM prompt
  const validation = validatePrompt(prompt);
  assert.equal(validation.ok, false);
  if (!validation.ok) {
    const rejection = describePromptRejection(validation, prompt);
    assert.equal(rejection.shouldLog, true);
    assert.equal(rejection.logMetadata.blocklistTier, "server");
    assert.equal(rejection.message, "Your prompt contains content that isn't allowed.");
  }
});