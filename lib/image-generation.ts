export const IMAGE_GENERATION_MODEL =
  "black-forest-labs/FLUX.1-schnell" as const;

export const IMAGE_GENERATION_WIDTH = 1024;
export const IMAGE_GENERATION_HEIGHT = 768;
export const IMAGE_GENERATION_STEPS = 3;
export const ITERATIVE_MODE_SEED = 123;

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

export const CONFIGURED_IMAGE_MODELS = [IMAGE_GENERATION_MODEL] as const;
