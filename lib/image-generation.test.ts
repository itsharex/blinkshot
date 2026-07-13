import assert from "node:assert/strict";
import test from "node:test";
import {
  IMAGE_GENERATION_MODEL,
  buildImageGenerationRequest,
  estimateImageGenerationCost,
} from "./image-generation";
import { serializeBraintrustError } from "./braintrust";
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
  assert.ok(Math.abs(trace.metrics.estimated_cost - 0.0021233664) < 1e-12);
  assert.deepEqual(trace.metadata.cost, {
    currency: "USD",
    pricePerMegapixel: 0.0027,
    pricingBaseSteps: 4,
    stepMultiplier: 1,
    billableMegapixels: 0.786432,
    estimatedCost: 0.0021233664,
  });
  assert.equal(serialized.includes(imagePayload), false);
  assert.equal(serialized.includes("b64_json"), false);
});

test("scales image cost above the pricing step floor", () => {
  assert.deepEqual(
    estimateImageGenerationCost({
      width: 1024,
      height: 768,
      steps: 8,
      imageCount: 2,
    }),
    {
      billableMegapixels: 1.572864,
      estimatedCost: 0.0084934656,
      pricePerMegapixel: 0.0027,
      pricingBaseSteps: 4,
      stepMultiplier: 2,
    },
  );
});

test("redacts a BYOK secret if a provider error echoes it", () => {
  const secret = "together-secret-key";
  const error = new Error(`Provider rejected ${secret}`);
  const serialized = JSON.stringify(serializeBraintrustError(error, [secret]));

  assert.equal(serialized.includes(secret), false);
  assert.equal(serialized.includes("[REDACTED]"), true);
});
