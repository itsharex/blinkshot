import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_GENERATION_MODEL,
  buildImageGenerationRequest,
} from "./image-generation";
import {
  buildGenerationTraceStart,
  buildGenerationTraceSuccess,
} from "./generation-tracing";

test("builds the effective styled prompt and iterative seed", () => {
  assert.deepEqual(
    buildImageGenerationRequest({
      prompt: "A lighthouse",
      style: "watercolor",
      iterativeMode: true,
    }),
    {
      effectivePrompt: "A lighthouse. Use a watercolor style for the image.",
      model: IMAGE_GENERATION_MODEL,
      width: 1024,
      height: 768,
      steps: 3,
      seed: 123,
    },
  );
});

test("records BYOK status without recording the key", () => {
  const secret = "together-secret-key";
  const trace = buildGenerationTraceStart(
    { prompt: "A lighthouse", iterativeMode: false },
    Boolean(secret),
  );
  const serialized = JSON.stringify(trace);

  assert.equal(trace.metadata.byok, true);
  assert.equal(trace.metadata.seeded, false);
  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("userAPIKey"), false);
});

test("keeps usage and timings while excluding base64 image data", () => {
  const imagePayload = "base64-image-payload";
  const trace = buildGenerationTraceSuccess(
    {
      id: "response-1",
      model: IMAGE_GENERATION_MODEL,
      usage: {
        credits: 0.002,
        nested: { b64_json: imagePayload, images: 1 },
      },
      data: [
        {
          b64_json: imagePayload,
          timings: { inference: 0.75 },
        },
      ],
    },
    812,
  );
  const serialized = JSON.stringify(trace);

  assert.deepEqual(trace.metadata.usage, {
    credits: 0.002,
    nested: { images: 1 },
  });
  assert.deepEqual(trace.metadata.timings, [{ inference: 0.75 }]);
  assert.equal(trace.metrics.inference_ms, 750);
  assert.equal(serialized.includes(imagePayload), false);
  assert.equal(serialized.includes("b64_json"), false);
});
