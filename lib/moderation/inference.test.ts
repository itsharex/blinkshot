import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { moderatePrompt } from "./inference";

// reference_scores.json is gitignored — it holds clinical adult prompts used only
// for local parity regression (no sensitive text is committed in this repo). The
// parity / verdict tests below SKIP when it is absent, so a fresh clone or CI still
// runs the benign + empty smoke tests without it. Loaded synchronously with a
// computed path so the bundler can't statically resolve (and fail on) the file.
const refPath = path.join(__dirname, "reference_scores.json");
let PY: Record<string, number> | null = null;
if (existsSync(refPath)) {
  try {
    PY = JSON.parse(readFileSync(refPath, "utf-8")) as Record<string, number>;
  } catch {
    PY = null;
  }
}

const TOLERANCE = 0.02;

// Parity vs the Python reference (run locally after export_deployable.py). Skipped
// on a fresh clone where the gitignored reference file is absent.
test(
  "scores match the Python reference within tolerance",
  { skip: !PY },
  () => {
    const failures: string[] = [];
    for (const [prompt, pyScore] of Object.entries(PY!)) {
      const ts = moderatePrompt(prompt);
      const diff = Math.abs(ts.score - pyScore);
      if (diff > TOLERANCE) {
        failures.push(
          `  Δ=${diff.toFixed(4)}>${TOLERANCE}  py=${pyScore.toFixed(4)} ts=${ts.score.toFixed(4)}  (prompt len ${prompt.length})`,
        );
      }
    }
    if (failures.length) assert.fail(`parity drift:\n${failures.join("\n")}`);
  },
);

test(
  "verdicts match the Python reference",
  { skip: !PY },
  () => {
    const failures: string[] = [];
    for (const [prompt, pyScore] of Object.entries(PY!)) {
      const ts = moderatePrompt(prompt);
      const pyVerdict = pyScore >= 0.5 ? "block" : "pass";
      const tsVerdict = ts.ok ? "pass" : "block";
      if (pyVerdict !== tsVerdict) {
        failures.push(
          `  py=${pyVerdict}(${pyScore.toFixed(4)}) ts=${tsVerdict}(${ts.score.toFixed(4)})  (prompt len ${prompt.length})`,
        );
      }
    }
    if (failures.length) assert.fail(`verdict mismatch:\n${failures.join("\n")}`);
  },
);

// Committed smoke tests use only benign prompts (no sensitive text in this repo).
test("benign prompts pass", () => {
  assert.ok(moderatePrompt("a red apple on a wooden table").ok, "apple");
  assert.ok(moderatePrompt("sunset over the mountains, cinematic lighting").ok, "sunset");
  assert.ok(moderatePrompt("a fluffy cat sleeping on a couch").ok, "cat");
});

test("empty / whitespace-only prompts do not crash and stay below threshold", () => {
  assert.equal(moderatePrompt("").ok, true);
  assert.equal(moderatePrompt("   ").ok, true);
});