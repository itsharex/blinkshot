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

// Full validation: length, then shared terms (tier "shared"), then server-only
// CSAM terms (tier "server"). The route uses this so the server always
// enforces the complete blocklist regardless of who calls.
export function validatePrompt(prompt: string): PromptValidation {
  if (isPromptTooShort(prompt)) {
    return { ok: false, reason: "too_short" };
  }

  const tokens = tokenizePrompt(prompt);

  for (const token of tokens) {
    if (SHARED_BLOCKED_TERMS.has(token)) {
      return { ok: false, reason: "blocked_term", tier: "shared" };
    }
  }

  for (const token of tokens) {
    if (SERVER_ONLY_BLOCKED_TERMS.has(token)) {
      return { ok: false, reason: "blocked_term", tier: "server" };
    }
  }

  // Age-phrase CSAM (minor age + "year/yr old") — see hasMinorAgePhrase.
  if (hasMinorAgePhrase(prompt)) {
    return { ok: false, reason: "blocked_term", tier: "server" };
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
      promptLength: prompt.trim().length,
    },
  };
}