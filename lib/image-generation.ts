export const IMAGE_GENERATION_MODEL =
  "black-forest-labs/FLUX.1-schnell" as const;

export const IMAGE_GENERATION_WIDTH = 1024;
export const IMAGE_GENERATION_HEIGHT = 768;
export const IMAGE_GENERATION_STEPS = 3;
export const ITERATIVE_MODE_SEED = 123;
// Canonical model page: https://www.together.ai/models/flux-1-schnell-2
export const IMAGE_GENERATION_PRICE_PER_MEGAPIXEL = 0.0027;
// Together bills the default four-step floor even when fewer steps are requested.
export const IMAGE_GENERATION_PRICING_BASE_STEPS = 4;

export type ImageGenerationInput = {
  prompt: string;
  iterativeMode: boolean;
  style?: string;
};

export function buildImageGenerationRequest(input: ImageGenerationInput) {
  const effectivePrompt = input.style
    ? `${input.prompt}. Use a ${input.style} style for the image.`
    : input.prompt;

  return {
    effectivePrompt,
    model: IMAGE_GENERATION_MODEL,
    width: IMAGE_GENERATION_WIDTH,
    height: IMAGE_GENERATION_HEIGHT,
    steps: IMAGE_GENERATION_STEPS,
    seed: input.iterativeMode ? ITERATIVE_MODE_SEED : undefined,
  };
}

export function estimateImageGenerationCost({
  width,
  height,
  steps,
  imageCount,
}: {
  width: number;
  height: number;
  steps: number;
  imageCount: number;
}) {
  const billableMegapixels = (width * height * imageCount) / 1_000_000;
  const stepMultiplier =
    Math.max(steps, IMAGE_GENERATION_PRICING_BASE_STEPS) /
    IMAGE_GENERATION_PRICING_BASE_STEPS;

  return {
    billableMegapixels,
    estimatedCost: Number(
      (
        billableMegapixels *
        IMAGE_GENERATION_PRICE_PER_MEGAPIXEL *
        stepMultiplier
      ).toFixed(12),
    ),
    pricePerMegapixel: IMAGE_GENERATION_PRICE_PER_MEGAPIXEL,
    pricingBaseSteps: IMAGE_GENERATION_PRICING_BASE_STEPS,
    stepMultiplier,
  };
}

export const CONFIGURED_IMAGE_MODELS = [IMAGE_GENERATION_MODEL] as const;
