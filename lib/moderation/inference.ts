import "server-only";
// NOTE: typed loosely (then cast) so tsc does not infer the 29,528-key vocab as a
// giant object-literal type. `resolveJsonModule` still inlines the JSON into the
// bundle at build time (works on Vercel nodejs); only the *type* is loosened here.
import rawModel from "./model.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ModerationDecision =
  | { ok: true; score: number; threshold: number }
  | { ok: false; reason: "ml_blocked"; score: number; threshold: number };

export type ModerationDecisionDescription = {
  shouldLog: boolean;
  message: string;
  logMetadata: {
    rejectionReason: "ml_blocked";
    score: number;
    threshold: number;
    promptLength: number;
  };
};

interface ModelFile {
  tokenizer: {
    vocab: string[]; // id-ordered; id == embedding row (token_mapping is identity)
    specialIds: { pad: number; unk: number; cls: number; sep: number };
    unkId: number;
    continuingPrefix: string;
  };
  embedding: {
    shape: [number, number];
    dtype: "int4";
    data: string; // base64 of packed signed nibbles, 2/byte, row-major
    scale: string; // base64 f32 per-row symmetric absmax / 7
  };
  weights: string; // base64 f32 (29528,)
  mlp: {
    coefs: [string, string]; // [base64 f32 (256,768), base64 f32 (768,2)]
    intercepts: [string, string]; // [base64 f32 (768,), base64 f32 (2,)]
    activation: "relu";
    outActivation: "softmax";
  };
  config: {
    dim: number;
    normalize: boolean;
    maxTokens: number;
    charTrunc: number;
    threshold: number;
    unsafeIndex: number;
  };
}

const M = rawModel as unknown as ModelFile;

// ms since the function instance started (Node boot + the JSON.parse of the
// 6.7MB model.json at import time). Captures the cost we can't time below,
// because it already happened during `import rawModel`.
const __bootMs = performance.now();

// ---------------------------------------------------------------------------
// Decode helpers
// ---------------------------------------------------------------------------

// Fast base64 -> bytes. Node's Buffer.from("base64") is C-level (used on the
// nodejs route + tests); falls back to atob + char copy on runtimes without
// Buffer (edge). Returns a Uint8Array view (byteOffset may be non-zero when
// Node pools, which the Float32Array view constructor handles correctly).
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return Buffer.from(b64, "base64");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function decodeF32(b64: string): Float32Array {
  const bytes = base64ToBytes(b64);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.length / 4);
}

function decodeBytes(b64: string): Uint8Array {
  return base64ToBytes(b64);
}

// ---------------------------------------------------------------------------
// Model load (module-scoped, one-time)
// ---------------------------------------------------------------------------

const DIM = M.config.dim; // 256
const MAX_TOKENS = M.config.maxTokens; // 512
const CHAR_TRUNC = M.config.charTrunc; // 3072 = 512 * median_token_length(6)
const THRESHOLD = M.config.threshold; // 0.5
const UNSAFE_INDEX = M.config.unsafeIndex; // 0 -> 'FAIL' = sexual-content/unsafe
const UNK_ID = M.tokenizer.unkId; // 1
const CONTINUE = M.tokenizer.continuingPrefix; // "##"

const D = M.embedding.shape[1]; // 256
const __t0 = performance.now();
const SCALE = decodeF32(M.embedding.scale); // Float32Array(29528)
const WEIGHTS = decodeF32(M.weights); // Float32Array(29528)
const EMB_BYTES = decodeBytes(M.embedding.data); // Uint8Array(packed nibbles)
const W0 = decodeF32(M.mlp.coefs[0]); // Float32Array(256*768), row-major
const W1 = decodeF32(M.mlp.coefs[1]); // Float32Array(768*2), row-major
const B0 = decodeF32(M.mlp.intercepts[0]); // Float32Array(768)
const B1 = decodeF32(M.mlp.intercepts[1]); // Float32Array(2)
const __tDecode = performance.now();

// Reverse vocab map: token string -> id. (vocab is id-ordered.)
const VOCAB = new Map<string, number>();
for (let id = 0; id < M.tokenizer.vocab.length; id++) {
  VOCAB.set(M.tokenizer.vocab[id], id);
}
const __tVocab = performance.now();

// Dequantize the int4 embedding into a full Float32Array(VOCAB_SIZE * DIM).
// int4 packing (see export_deployable.py): byte k>>1 holds two signed nibbles;
// low nibble = flat index 2i, high nibble = flat index 2i+1; value = q * scale[row].
// Embedding is dequantized lazily per-token-row in encode() (only the ~10 rows a
// prompt touches), NOT as a 30MB upfront array. The upfront dequant was ~360ms
// of cold start + 30MB resident per instance; both are now avoided.
//
// Cold-start init diagnostics. Gated to non-production (local dev + Vercel
// previews): VERCEL_ENV is "development" locally (unset → verbose) or "preview"
// on previews, "production" on prod. This module loads on cold start of every
// importing route (incl. /api/generateImages), so without the gate this line
// would land in production logs on every cold start.
if (process.env.VERCEL_ENV !== "production") {
  console.log(
    `[moderation:perf] init boot=${__bootMs.toFixed(0)}ms decode=${(__tDecode - __t0).toFixed(0)}ms vocab=${(__tVocab - __tDecode).toFixed(0)}ms total=${(__tVocab - __bootMs).toFixed(0)}ms (lazy dequant, ${M.tokenizer.vocab.length} vocab)`,
  );
}

// ---------------------------------------------------------------------------
// Tokenizer: BertWordPiece (BertNormalizer + BertPreTokenizer + WordPiece),
// matching HF `tokenizers` with add_special_tokens=false (no [CLS]/[SEP]).
// Replicates BERT BasicTokenizer + WordpieceTokenizer.
// ---------------------------------------------------------------------------

function isPunctuation(cp: number, ch: string): boolean {
  if (
    (cp >= 33 && cp <= 47) ||
    (cp >= 58 && cp <= 64) ||
    (cp >= 91 && cp <= 96) ||
    (cp >= 123 && cp <= 126)
  ) {
    return true;
  }
  return PUNCT_RE.test(ch);
}
const PUNCT_RE = /\p{P}/u;

function isWhitespace(ch: string): boolean {
  if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") return true;
  return SPACE_RE.test(ch);
}
const SPACE_RE = /\p{Zs}/u;

function isControl(ch: string): boolean {
  if (ch === "\t" || ch === "\n" || ch === "\r") return false;
  return CONTROL_RE.test(ch);
}
const CONTROL_RE = /\p{C}/u;

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  [0x4e00, 0x9fff],
  [0x3400, 0x4dbf],
  [0x20000, 0x2a6df],
  [0x2a700, 0x2b73f],
  [0x2b740, 0x2b81f],
  [0x2b820, 0x2ceaf],
  [0xf900, 0xfaff],
  [0x2f800, 0x2fa1f],
];
function isChineseChar(cp: number): boolean {
  for (const [lo, hi] of CJK_RANGES) if (cp >= lo && cp <= hi) return true;
  return false;
}

// BERT _clean_text: drop U+0000 and U+FFFD, drop control chars, whitespace -> " ".
function cleanText(text: string): string {
  let out = "";
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0 || cp === 0xfffd) continue;
    if (isControl(ch)) continue;
    if (isWhitespace(ch)) {
      out += " ";
      continue;
    }
    out += ch;
  }
  return out;
}

// BERT _handle_chinese_chars: pad each CJK char with spaces.
function handleChineseChars(text: string): string {
  let out = "";
  for (const ch of text) {
    if (isChineseChar(ch.codePointAt(0)!)) out += ` ${ch} `;
    else out += ch;
  }
  return out;
}

// BERT _run_strip_accents: NFD then drop combining marks (Mn).
function stripAccents(token: string): string {
  return token.normalize("NFD").replace(MN_RE, "");
}
const MN_RE = /\p{Mn}/gu;

// BERT whitespace_tokenize = Python str.split() (runs of whitespace, drop empties).
function whitespaceSplit(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

// BERT _run_split_on_punc: isolate each punctuation char as its own piece.
function splitOnPunc(token: string): string[] {
  const chars = Array.from(token);
  const pieces: string[][] = [];
  let startNew = true;
  for (const ch of chars) {
    const cp = ch.codePointAt(0)!;
    if (isPunctuation(cp, ch)) {
      pieces.push([ch]);
      startNew = true;
    } else {
      if (startNew) pieces.push([]);
      startNew = false;
      pieces[pieces.length - 1].push(ch);
    }
  }
  return pieces.map((a) => a.join(""));
}

// WordPiece: greedy longest-match from the start; continuation substrings are
// prefixed with "##". If any subword fails to match, the whole word -> [UNK].
function wordpiece(token: string): number[] {
  const chars = Array.from(token);
  const out: number[] = [];
  let start = 0;
  while (start < chars.length) {
    let end = chars.length;
    let found: number | undefined;
    while (start < end) {
      const substr = chars.slice(start, end).join("");
      const key = start > 0 ? CONTINUE + substr : substr;
      const id = VOCAB.get(key);
      if (id !== undefined) {
        found = id;
        break;
      }
      end -= 1;
    }
    if (found === undefined) return [UNK_ID];
    out.push(found);
    start = end;
  }
  return out;
}

// Full tokenize -> token ids, matching model2vec StaticModel.encode:
//   char-trunc to (max_length * median_token_length) -> normalize -> pre-tokenize
//   -> WordPiece -> drop [UNK] (id==1) -> truncate ids to max_length (512).
function tokenize(text: string): number[] {
  const truncated = text.slice(0, CHAR_TRUNC);

  // BertNormalizer
  let cleaned = cleanText(truncated);
  cleaned = handleChineseChars(cleaned);

  // BertPreTokenizer (whitespace split + per-token lowercase/strip + punc split)
  const pieces: string[] = [];
  for (const tok of whitespaceSplit(cleaned)) {
    const lowered = stripAccents(tok.toLowerCase());
    for (const piece of splitOnPunc(lowered)) pieces.push(piece);
  }

  // WordPiece -> ids
  const ids: number[] = [];
  for (const piece of pieces) {
    if (piece === "") continue;
    for (const id of wordpiece(piece)) ids.push(id);
  }

  // model2vec post-steps: drop [UNK], truncate to max_length
  const filtered = ids.filter((id) => id !== UNK_ID).slice(0, MAX_TOKENS);
  return filtered;
}

// ---------------------------------------------------------------------------
// Encode: weighted mean over token embeddings, then L2-normalize.
//   vec = mean_over_tokens( weights[t] * embedding[t] )  then  vec /= (||vec|| + 1e-32)
// ---------------------------------------------------------------------------

function encode(ids: number[]): Float32Array {
  if (ids.length === 0) return new Float32Array(DIM); // zeros -> MLP baseline
  const acc = new Float64Array(DIM);
  for (const id of ids) {
    // Dequantize only this token's row on demand (int4 -> f32): the int4 packing
    // (see export_deployable.py) stores two signed nibbles per byte, low nibble
    // at even flat index, high at odd; row*D is even so col parity == flat parity.
    // wScale folds the token weight and the row's int4 scale into one multiplier.
    const wScale = WEIGHTS[id] * SCALE[id];
    const rowBase = id * D;
    for (let col = 0; col < D; col++) {
      const byte = EMB_BYTES[(rowBase + col) >> 1];
      const nib = (col & 1) === 0 ? byte & 0x0f : (byte >>> 4) & 0x0f;
      const q = nib >= 8 ? nib - 16 : nib; // sign-extend 4-bit two's complement
      acc[col] += q * wScale;
    }
  }
  const n = ids.length;
  let norm = 0;
  for (let j = 0; j < DIM; j++) {
    acc[j] /= n;
    norm += acc[j] * acc[j];
  }
  norm = Math.sqrt(norm) + 1e-32;
  const vec = new Float32Array(DIM);
  for (let j = 0; j < DIM; j++) vec[j] = acc[j] / norm;
  return vec;
}

// ---------------------------------------------------------------------------
// MLP forward: h = relu(vec . W0 + b0) (256->768); logits = h . W1 + b1 (768->2);
// softmax. W0 row-major (256,768): W0[i*768 + j]. W1 row-major (768,2): W1[j*2 + k].
// Returns [P(FAIL), P(PASS)]; index 0 (FAIL) = unsafe.
// ---------------------------------------------------------------------------

function mlpForward(vec: Float32Array): [number, number] {
  const h = new Float32Array(768);
  for (let j = 0; j < 768; j++) {
    let s = B0[j];
    for (let i = 0; i < 256; i++) s += vec[i] * W0[i * 768 + j];
    h[j] = s > 0 ? s : 0; // relu
  }
  let l0 = B1[0];
  let l1 = B1[1];
  for (let j = 0; j < 768; j++) {
    const hj = h[j];
    l0 += hj * W1[j * 2];
    l1 += hj * W1[j * 2 + 1];
  }
  const m = Math.max(l0, l1);
  const e0 = Math.exp(l0 - m);
  const e1 = Math.exp(l1 - m);
  const sum = e0 + e1;
  return [e0 / sum, e1 / sum];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type ModerationTiming = {
  tokenize: number;
  encode: number;
  mlp: number;
  total: number;
};

export function moderatePromptWithTiming(
  prompt: string,
): { decision: ModerationDecision; timing: ModerationTiming } {
  const t0 = performance.now();
  const ids = tokenize(prompt);
  const t1 = performance.now();
  const vec = encode(ids);
  const t2 = performance.now();
  const [pFail] = mlpForward(vec);
  const t3 = performance.now();
  const score = pFail; // P(FAIL) = P(unsafe)
  const decision: ModerationDecision =
    score < THRESHOLD
      ? { ok: true, score, threshold: THRESHOLD }
      : { ok: false, reason: "ml_blocked", score, threshold: THRESHOLD };
  return {
    decision,
    timing: {
      tokenize: t1 - t0,
      encode: t2 - t1,
      mlp: t3 - t2,
      total: t3 - t0,
    },
  };
}

export function moderatePrompt(prompt: string): ModerationDecision {
  return moderatePromptWithTiming(prompt).decision;
}

// Mirrors lib/prompt-validation.server.ts describePromptRejection: a pure helper
// the route uses to decide logging + build the user-facing 400 body. shouldLog is
// true only on a block; metadata carries no raw prompt text (privacy contract).
export function describeModerationDecision(
  decision: Extract<ModerationDecision, { ok: false }>,
  prompt: string,
): ModerationDecisionDescription {
  return {
    shouldLog: true,
    message: "Your prompt was flagged by moderation.",
    logMetadata: {
      rejectionReason: "ml_blocked",
      score: decision.score,
      threshold: decision.threshold,
      promptLength: prompt.length,
    },
  };
}