// Server-only prompt validation. This module MUST NOT be imported by any
// client component — it contains CSAM-specific terms we deliberately keep
// out of the browser bundle. `import "server-only"` turns any accidental
// client import into a hard build error. Only the API route imports this.
//
// For the rationale (why CSAM is server-only and the client cannot see these
// terms), see the plan and the tiered-blocklist decision.

import "server-only";

import {
  SHARED_BLOCKED_TERMS,
  decodeTerms,
  isPromptTooShort,
  tokenizePrompt,
  type PromptRejectionRule,
  type PromptValidation,
  type PromptValidationReason,
} from "./prompt-validation";

// CSAM-specific terms, base64-encoded (see `decodeTerms` in the shared module)
// so the literal words are not committed to the public repo and not plaintext in
// the server bundle. NOT shipped to the client (this module is server-only).
// Intentionally excludes ambiguous common words (child, kid, baby, teen,
// schoolgirl, girl, boy, young) that would block legitimate prompts; that
// exclusion is locked in by tests in `prompt-validation.test.ts`. Extend this
// set (regenerate the blob from the gitignored BAD-PROMPTS.md) as new abuse
// terms surface in the Braintrust logs.
const SERVER_ONLY_BLOCKED_TERMS: ReadonlySet<string> = decodeTerms(
  "cHJldGVlbgp1bmRlcmFnZQp0d2Vlbgpsb2xpCmxvbGljb24Kc2hvdGEKc2hvdGFjb24KdG9kZGxlcmNvbgpwZWRvcGhpbGUKcGVkb3BoaWxpYQpwZWRvCmtpZGRpZQpraWRkeQpjc2Ft",
);

// Non-English sexual/anatomy terms, base64-encoded (see `decodeTerms`) and
// matched as whole ASCII-folded tokens (diacritics stripped first by
// `tokenizePrompt`, so e.g. an accented German token folds before matching). NOT
// shipped to the client (server-only). Curated from the 2026-07-21 Braintrust
// audit of non-English abuse prompts that returned images — Portuguese, Swahili,
// and German — because the enguard-8m model is an English BERT and scores these
// well under threshold. Deliberately narrow and evidence-based (only terms
// observed succeeding in prod) so benign non-English prompts stay unblocked
// (e.g. a Portuguese Wikipedia paste, Italian news-article images); the Swahili
// infinitive for "to stand" (a benign common verb that co-occurs in the spam) is
// deliberately NOT blocked, since the spam's sexual-organ term alone catches
// every observed variant. Extend only with log-confirmed terms; regenerate the
// blob from the gitignored BAD-PROMPTS.md when extending.
const NON_ENGLISH_BLOCKED_TERMS: ReadonlySet<string> = decodeTerms(
  "bnVhCnNleG8KYnVjZXRhCmdvemFuZG8KdXVtZQpicnVzdGVuCmJydXN0ZQpidXNlbg==",
);

// Minor-age word forms (all <= 17). Used by the age-phrase rule below.
const MINOR_AGE_WORDS: ReadonlySet<string> = new Set([
  "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen",
]);

// Closes the CSAM gap that single-word terms miss: prompts that state a minor's
// age but use no sexual/anatomy token. Returns true when the prompt names a
// minor age (1-17) next to "year(s)/yr(s) old" — including hyphenated danbooru
// forms and word-form ages. The <=17 guard keeps adult-age prompts (18+)
// allowed. (Concrete example prompts live in the gitignored BAD-PROMPTS.md,
// not in source.)
function hasMinorAgePhrase(prompt: string): boolean {
  const lower = prompt.toLowerCase();

  // Digit age: <1-17> year(s)/yr(s) old, with optional hyphens/spaces.
  const digitYear = lower.match(/\b(\d{1,2})\s*-?\s*year[s]?\s*-?\s*old\b/);
  if (digitYear) {
    const age = parseInt(digitYear[1], 10);
    if (age >= 1 && age <= 17) return true;
  }
  const digitYr = lower.match(/\b(\d{1,2})\s*-?\s*yrs?\s*-?\s*old\b/);
  if (digitYr) {
    const age = parseInt(digitYr[1], 10);
    if (age >= 1 && age <= 17) return true;
  }

  // Word-form age: <minor-word> year(s)/yr(s) old (consecutive tokens).
  const tokens = tokenizePrompt(prompt);
  for (let i = 0; i + 2 < tokens.length; i++) {
    if (
      MINOR_AGE_WORDS.has(tokens[i]) &&
      (tokens[i + 1] === "year" ||
        tokens[i + 1] === "years" ||
        tokens[i + 1] === "yr" ||
        tokens[i + 1] === "yrs") &&
      tokens[i + 2] === "old"
    ) {
      return true;
    }
  }

  return false;
}

// Sexualized adjectives with benign object uses ("a sexy sports car", "a curvy
// winding road") that become sexual when applied to a person. A bare block would
// false-positive on the benign object uses, so this gates them by context: block
// when the prompt reduces to just the adjective + filler (a standalone
// "sexy"/"curvy" has no benign image-gen use — benign uses always carry an object
// noun), or when the adjective directly precedes a person noun ("a sexy girl").
// Direct adjacency — not mere co-occurrence — is what avoids the false positive
// where a person appears elsewhere in an otherwise-benign prompt: "a curvy road
// with a girl riding a bike" stays allowed (the girl isn't adjacent to "curvy").
// Server-only; tier "server". (Concrete example prompts live in the gitignored
// BAD-PROMPTS.md, not in source.)
const SEXUALIZED_ADJECTIVES = new Set(["sexy", "curvy"]);
const ADJECTIVE_INTENSIFIERS = new Set([
  "very", "extremely", "super", "really", "so", "quite", "pretty", "highly", "too",
]);
// Function words only (never content nouns) — used to detect a standalone
// sexualized adjective with no object. Keeping this function-only is what
// prevents a content noun from being mistaken for filler (which would over-block).
const FILLER_WORDS = new Set([
  "a", "an", "the", "of", "with", "and", "on", "in", "at", "to", "is", "are", "was",
  "be", "that", "it", "as", "by", "for", "from", "this", "or", "but",
]);
// Person-reference nouns. Directly adjacent to a sexualized adjective they make
// the phrase sexual ("a sexy girl"); the same nouns elsewhere are benign and are
// deliberately excluded from the bare blocklists (see the exclusion tests).
// `model` is intentionally omitted — it is ambiguous (fashion model vs. car/3D
// model) and would false-positive on "a sexy model car".
const PERSON_TOKENS = new Set([
  "girl", "woman", "women", "boy", "man", "lady", "babe", "chick", "guy",
  "nurse", "teacher", "person", "dude", "gentleman", "gal",
]);
function hasSexualizedAdjectivePhrase(prompt: string): boolean {
  const tokens = tokenizePrompt(prompt);
  // Standalone: no content noun remains (only the adjective + intensifiers +
  // function words) → a bare sexualized adjective, which has no benign use.
  const hasContentNoun = tokens.some(
    (t) =>
      !SEXUALIZED_ADJECTIVES.has(t) &&
      !ADJECTIVE_INTENSIFIERS.has(t) &&
      !FILLER_WORDS.has(t),
  );
  for (let i = 0; i < tokens.length; i++) {
    if (!SEXUALIZED_ADJECTIVES.has(tokens[i])) continue;
    if (!hasContentNoun) return true;
    // Direct adjacency: the adjective immediately precedes a person noun.
    const next = tokens[i + 1];
    if (next && PERSON_TOKENS.has(next)) return true;
  }
  return false;
}

// Full validation: length, then shared terms (tier "shared"), then server-only
// CSAM terms (tier "server"). The route uses this so the server always
// enforces the complete blocklist regardless of who calls.
export function validatePrompt(prompt: string): PromptValidation {
  if (isPromptTooShort(prompt)) {
    return { ok: false, reason: "too_short" };
  }

  const tokens = tokenizePrompt(prompt);

  // Each return carries a `rule` — the coarse mechanism label surfaced to the
  // Braintrust rejection metadata (via describePromptRejection → `rejectionRule`)
  // so the block-rate dashboard can break blocks down by mechanism without
  // storing prompt text or the matched term. See `PromptRejectionRule`.
  for (const token of tokens) {
    if (SHARED_BLOCKED_TERMS.has(token)) {
      return { ok: false, reason: "blocked_term", tier: "shared", rule: "shared-term" };
    }
  }

  for (const token of tokens) {
    if (SERVER_ONLY_BLOCKED_TERMS.has(token)) {
      return { ok: false, reason: "blocked_term", tier: "server", rule: "csam-term" };
    }
  }

  // Non-English sexual/anatomy terms (server-only; ASCII-folded by the
  // tokenizer). Closes the gap the English-BERT ML gate leaves on PT/Swahili/DE.
  for (const token of tokens) {
    if (NON_ENGLISH_BLOCKED_TERMS.has(token)) {
      return { ok: false, reason: "blocked_term", tier: "server", rule: "non-english-term" };
    }
  }

  // Age-phrase CSAM (minor age + "year/yr old") — see hasMinorAgePhrase.
  if (hasMinorAgePhrase(prompt)) {
    return { ok: false, reason: "blocked_term", tier: "server", rule: "minor-age-phrase" };
  }

  // Sexualized-adjective phrase rule (server-only). Closes the `sexy`/`curvy`
  // adult-tail gap the bare blocklist can't safely cover (benign object uses).
  if (hasSexualizedAdjectivePhrase(prompt)) {
    return { ok: false, reason: "blocked_term", tier: "server", rule: "sexualized-phrase" };
  }

  return { ok: true };
}

// Maps a failed validation to its user-facing 400 message + the Braintrust log
// metadata. Pure (no I/O, no logging) so the route's "log only blocked_term,
// never too_short" decision is unit-tested in `prompt-validation.test.ts`.
// `too_short` is typing noise and the easiest flood vector (empty/short bodies)
// and the route runs this path before the rate limiter, so it is deliberately
// NOT logged; `blocked_term` is the abuse signal this gate exists to catch.
// Route-specific keys (route, phase, success, span name/type) stay in the route.
export function describePromptRejection(
  validation: Extract<PromptValidation, { ok: false }>,
  prompt: string,
): {
  shouldLog: boolean;
  message: string;
  logMetadata: {
    rejectionReason: PromptValidationReason;
    blocklistTier: "shared" | "server" | null;
    rejectionRule: PromptRejectionRule | null;
    promptLength: number;
  };
} {
  const reason = validation.reason;
  return {
    shouldLog: reason === "blocked_term",
    message:
      reason === "too_short"
        ? "Please enter a longer prompt (at least 3 characters)."
        : "Your prompt contains content that isn't allowed.",
    logMetadata: {
      rejectionReason: reason,
      blocklistTier: validation.tier ?? null,
      // Coarse mechanism label for the block-rate dashboard (no prompt text, no
      // specific matched term — the privacy contract is preserved).
      rejectionRule: validation.rule ?? null,
      promptLength: prompt.trim().length,
    },
  };
}