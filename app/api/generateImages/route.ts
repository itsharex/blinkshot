import Together from "together-ai";
import { z } from "zod";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { headers } from "next/headers";
import {
  flushBraintrust,
  getBraintrustLogger,
  logBraintrustFailure,
  serializeBraintrustError,
  type Span,
} from "@/lib/braintrust";
import { buildImageGenerationRequest } from "@/lib/image-generation";
import {
  buildGenerationTraceStart,
  buildGenerationTraceSuccess,
} from "@/lib/generation-tracing";

let ratelimit: Ratelimit | undefined;

// Add rate limiting if Upstash API keys are set, otherwise skip
if (process.env.UPSTASH_REDIS_REST_URL) {
  ratelimit = new Ratelimit({
    redis: Redis.fromEnv(),
    // Allow 5 requests per day (~1 prompt), then need to use API key
    limiter: Ratelimit.fixedWindow(5, "1440 m"),
    analytics: true,
    prefix: "blinkshot",
  });
}

export async function POST(req: Request) {
  const logger = getBraintrustLogger();
  let traceStarted = false;

  try {
    const json = await req.json();
    const { prompt, userAPIKey, iterativeMode, style } = z
      .object({
        prompt: z.string(),
        iterativeMode: z.boolean(),
        userAPIKey: z.string().optional(),
        style: z.string().optional(),
      })
      .parse(json);

    const input = { prompt, iterativeMode, style };

    // Add observability if a Helicone key is specified, otherwise skip
    const options: ConstructorParameters<typeof Together>[0] = {};
    if (process.env.HELICONE_API_KEY) {
      options.baseURL = "https://together.helicone.ai/v1";
      options.defaultHeaders = {
        "Helicone-Auth": `Bearer ${process.env.HELICONE_API_KEY}`,
        "Helicone-Property-BYOK": userAPIKey ? "true" : "false",
      };
    }

    const client = new Together(options);

    if (userAPIKey) {
      client.apiKey = userAPIKey;
    }

    if (ratelimit && !userAPIKey) {
      const identifier = await getIPAddress();

      const { success } = await ratelimit.limit(identifier);
      if (!success) {
        return Response.json(
          "No requests left. Please add your own API key or try again in 24h.",
          {
            status: 429,
          },
        );
      }
    }

    const generateImage = async (span?: Span) => {
      const imageRequest = buildImageGenerationRequest(input);
      const startedAt = performance.now();

      try {
        const response = await client.images.create({
          prompt: imageRequest.effectivePrompt,
          model: imageRequest.model,
          width: imageRequest.width,
          height: imageRequest.height,
          seed: imageRequest.seed,
          steps: imageRequest.steps,
          // @ts-expect-error - this is not typed in the API
          response_format: "base64",
        });

        span?.log(
          buildGenerationTraceSuccess(response, performance.now() - startedAt),
        );
        return Response.json(response.data[0]);
      } catch (error) {
        span?.log({
          error: serializeBraintrustError(error),
          metadata: { success: false },
          metrics: { duration_ms: performance.now() - startedAt },
        });
        return Response.json(
          { error: String(error) },
          {
            status: 500,
          },
        );
      }
    };

    if (!logger) return await generateImage();

    traceStarted = true;
    const response = await logger.traced((span) => generateImage(span), {
      name: "blinkshot.generate-image",
      type: "llm",
      event: buildGenerationTraceStart(input, Boolean(userAPIKey)),
    });
    await flushBraintrust();
    return response;
  } catch (error) {
    if (!traceStarted) {
      await logBraintrustFailure(
        {
          name: "blinkshot.generate-image",
          type: "llm",
          event: {
            metadata: {
              route: "/api/generateImages",
              phase: "request-validation",
              success: false,
            },
          },
        },
        error,
      );
    }
    await flushBraintrust();
    return Response.json({ error: String(error) }, { status: 400 });
  }
}

export const runtime = "edge";

async function getIPAddress() {
  const FALLBACK_IP_ADDRESS = "0.0.0.0";
  const headersList = await headers();
  const forwardedFor = headersList.get("x-forwarded-for");

  if (forwardedFor) {
    return forwardedFor.split(",")[0] ?? FALLBACK_IP_ADDRESS;
  }

  return headersList.get("x-real-ip") ?? FALLBACK_IP_ADDRESS;
}
