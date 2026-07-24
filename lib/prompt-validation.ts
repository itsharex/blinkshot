// Shared, client-safe prompt validation.
//
// This module is imported by both the API route (server) and the browser
// (app/page.tsx). It must NEVER contain terms we do not want to ship to the
// client bundle. CSAM-specific terms live only in the server-only companion
// module (`prompt-validation.server.ts`), which is imported solely by the
// route and guarded with `import "server-only"`.

export const MIN_PROMPT_LENGTH = 3;

// Decode a newline-separated base64 term list into a Set. `atob` is available
// in browsers, Node 16+, and the Next edge runtime. Base64 keeps the literal
// words out of the committed source and out of the client bundle's plaintext —
// this is obfuscation, not secrecy (trivially decodable); server-side
// enforcement is the real control. Plaintext source of truth lives in the
// gitignored BAD-PROMPTS.md.
export function decodeTerms(encoded: string): Set<string> {
  return new Set(
    atob(encoded)
      .split("\n")
      .map((term) => term.trim())
      .filter(Boolean),
  );
}

// Generic NSFW terms, base64-encoded (see `decodeTerms`). Matched as whole,
// case-insensitive tokens (see `tokenizePrompt`), so substrings inside other
// words do not false-positive. Kept base64 deliberately so the literal words
// stay out of the committed source and the client bundle's plaintext
// (obfuscation, not secrecy — server-side enforcement is the real control).
// Intentionally excludes ambiguous common words (child, kid, baby, teen,
// girl, ...) which would block legitimate prompts — see the exclusion tests —
// and borderline adjectives with benign uses (e.g. "sexy", "curvy"), which stay
// allowed as bare blocks; use a phrase rule for those. Regenerate the blob from
// the gitignored BAD-PROMPTS.md when extending.
export const SHARED_BLOCKED_TERMS: ReadonlySet<string> = decodeTerms(
  "YW5hbAphc3MKYmRzbQpibG93am9iCmJvbmRhZ2UKYm9vYgpib29icwpicmVhc3QKYnJlYXN0cwpidXN0eQpidXR0CmNsZWF2YWdlCmNvY2sKY29ja3MKY3JlYW1waWUKY3Vtc2hvdApkaWNrCmRpY2tzCmRpbGRvCmVyb3RpYwplcm90aWNhCmZ1Y2sKZnVja2luZwpnYW5nYmFuZwpnZW5pdGFscwpoYW5kam9iCmhlbnRhaQpsaW5nZXJpZQptaWxmCm5ha2VkCm5pcHBsZQpuaXBwbGVzCm51ZGUKbnVkZXMKbnVkaXR5Cm5zZncKb3JneQpwYW50aWVzCnBhbnR5CnBlbmlzCnBvcm4KcG9ybm8KcG9ybm9ncmFwaGljCnBvcm5vZ3JhcGh5CnB1c3N5CnB1c3NpZXMKc2V4CnNleHVhbApzbHV0CnRpdAp0aXRzCnZhZ2luYQp2aWJyYXRvcgp3aG9yZQ==",
);

export type PromptValidationReason = "too_short" | "blocked_term";

// Coarse category naming WHICH mechanism rejected a prompt. Propagated to the
// Braintrust rejection metadata (as `rejectionRule`) so the block-rate dashboard
// can break blocks down by mechanism — WITHOUT storing any prompt text or the
// specific matched term (the privacy contract is still "no raw prompt text").
// The client validator (`validatePromptShared`) only ever produces "shared-term";
// the server-only rules produce the rest. See `describePromptRejection`.
export type PromptRejectionRule =
  | "shared-term"
  | "csam-term"
  | "non-english-term"
  | "minor-age-phrase"
  | "sexualized-phrase";

export type PromptValidation =
  | { ok: true }
  | {
      ok: false;
      reason: PromptValidationReason;
      tier?: "shared" | "server";
      rule?: PromptRejectionRule;
    };

// Lowercase, fold Latin diacritics to ASCII (`café` → `cafe`, `naïve` → `naive`)
// — needed so accented non-English abuse tokens match the server-only term set —
// then split on any run of non-alphanumeric characters and drop empties. Folding
// is a no-op for plain ASCII, so English matching is unchanged. This yields
// whole-word tokens, so a benign word that merely contains a blocked substring
// (see the gitignored fixtures) is never matched.
// Combining diacritical marks (U+0300–U+036F), stripped after NFD decomposition
// so accented tokens fold to ASCII (`café` → `cafe`). Built from code points to
// keep the source readable — no invisible combining characters in a regex literal.
const COMBINING_DIACRITICS = new RegExp(
  "[" + String.fromCharCode(0x0300) + "-" + String.fromCharCode(0x036f) + "]",
  "g",
);

export function tokenizePrompt(prompt: string): string[] {
  return prompt
    .toLowerCase()
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

function findBlockedTerm(
  prompt: string,
  terms: ReadonlySet<string>,
): string | null {
  for (const token of tokenizePrompt(prompt)) {
    if (terms.has(token)) return token;
  }
  return null;
}

export function isPromptTooShort(prompt: string): boolean {
  return prompt.trim().length < MIN_PROMPT_LENGTH;
}

// Client-facing validation: length + shared terms only. The client cannot see
// the server-only CSAM terms, so it cannot catch those (the server does).
export function validatePromptShared(prompt: string): PromptValidation {
  if (isPromptTooShort(prompt)) {
    return { ok: false, reason: "too_short" };
  }

  if (findBlockedTerm(prompt, SHARED_BLOCKED_TERMS) !== null) {
    return { ok: false, reason: "blocked_term", tier: "shared", rule: "shared-term" };
  }

  return { ok: true };
}