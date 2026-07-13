import {
  CONFIGURED_IMAGE_MODELS,
  IMAGE_GENERATION_PRICE_PER_MEGAPIXEL,
  IMAGE_GENERATION_PRICING_BASE_STEPS,
} from "../lib/image-generation";

const apiKey = process.env.TOGETHER_API_KEY;
if (!apiKey) {
  throw new Error("TOGETHER_API_KEY is required to query the live catalog");
}

type CatalogModel = {
  id?: string;
  type?: string;
  pricing?: {
    image_pixel?: {
      price_per_megapixel?: number;
      min_steps?: number;
    };
  };
};

async function main() {
  const response = await fetch("https://api.together.xyz/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Together model catalog returned ${response.status}`);
  }

  const body = (await response.json()) as
    | CatalogModel[]
    | { data?: CatalogModel[] };
  const catalog = Array.isArray(body) ? body : (body.data ?? []);

  const results = CONFIGURED_IMAGE_MODELS.map((model) => {
    const entry = catalog.find((candidate) => candidate.id === model);
    const serverlessImage =
      entry?.type === "image" &&
      typeof entry.pricing?.image_pixel?.price_per_megapixel === "number";
    const pricePerMegapixel =
      entry?.pricing?.image_pixel?.price_per_megapixel ?? null;
    const pricingBaseSteps = entry?.pricing?.image_pixel?.min_steps ?? null;
    const pricingMatches =
      pricePerMegapixel === IMAGE_GENERATION_PRICE_PER_MEGAPIXEL &&
      pricingBaseSteps === IMAGE_GENERATION_PRICING_BASE_STEPS;

    return {
      model,
      present: Boolean(entry),
      type: entry?.type ?? null,
      serverlessImage,
      pricePerMegapixel,
      pricingBaseSteps,
      pricingMatches,
    };
  });

  if (
    results.some((result) => !result.serverlessImage || !result.pricingMatches)
  ) {
    throw new Error(`Model verification failed: ${JSON.stringify(results)}`);
  }

  console.log(
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        catalogModels: catalog.length,
        configuredModels: results,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
