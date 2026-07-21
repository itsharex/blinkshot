import { z } from "zod";
import { headers } from "next/headers";
import { flushBraintrust, logBraintrustFailure } from "@/lib/braintrust";
import { isAllowedOrigin, originOf } from "@/lib/origin-guard";
import {
  describeModerationDecision,
  moderatePromptWithTiming,
} from "@/lib/moderation/inference";

// Allowed origins for the defense-in-depth origin guard. Mirrors
// app/api/generateImages/route.ts (candidate to extract to lib/origin-guard when
// this gate is wired into the main route in Phase 6).
function buildAllowedOrigins(): Set<string> {
  const origins = new Set<string>();
  if (process.env.NEXT_PUBLIC_SITE_URL) {
    origins.add(process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, ""));
  }
  if (process.env.VERCEL_URL) {
    origins.add(`https://${process.env.VERCEL_URL}`);
  }
  if (process.env.NODE_ENV !== "production") {
    origins.add("http://localhost:3000");
  }
  return origins;
}

const allowedOrigins = buildAllowedOrigins();

// Node runtime: no edge ~4MB bundle cap, so the ~6.7MB model.json inlines cleanly
// via the `import` in lib/moderation/inference.ts. fs/Buffer available if needed.
export const runtime = "nodejs";

export async function POST(req: Request) {
  // Debug-only probe, closed in production. This route runs the moderation model
  // on an arbitrary prompt and returns the score — an oracle for "does this
  // prompt clear the ML gate?" In production that is an attack surface: it is
  // unratelimited, so an attacker on the same origin could tune euphemisms past
  // the gate here without spending image-gen tokens in /api/generateImages. The
  // authoritative gate lives there; this route is only for local dev + Vercel
  // previews (VERCEL_ENV "development"/"preview"), where it verifies the model
  // runs on real infra without a full image call.
  if (process.env.VERCEL_ENV === "production") {
    return Response.json({ error: "Not Found" }, { status: 404 });
  }

  const __reqT0 = performance.now();
  const headersList = await headers();

  // Defense-in-depth origin guard (same speed-bump as the image route; spoofable).
  if (
    !isAllowedOrigin({
      origin: headersList.get("origin"),
      referer: headersList.get("referer"),
      secFetchSite: headersList.get("sec-fetch-site"),
      allowedOrigins,
      allowLocalhost: process.env.NODE_ENV !== "production",
    })
  ) {
    const origin = headersList.get("origin");
    const referer = headersList.get("referer");
    if (origin !== null || referer !== null) {
      await logBraintrustFailure(
        {
          name: "blinkshot.generate-image",
          type: "llm",
          event: {
            metadata: {
              route: "/api/moderate",
              phase: "origin-guard",
              success: false,
              rejectedOrigin: origin,
              rejectedRefererOrigin: referer ? originOf(referer) : null,
            },
          },
        },
        new Error("origin rejected"),
      );
      await flushBraintrust();
    }
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const json = await req.json();
    const { prompt } = z.object({ prompt: z.string() }).parse(json);

    // ML residual layer: the enguard tiny-guard-8m pure-TS port. Runs on the raw
    // prompt (the style suffix is appended later, only in the image route).
    const { decision, timing } = moderatePromptWithTiming(prompt);
    console.log(
      `[moderate:perf] promptLen=${prompt.length} ok=${decision.ok} score=${decision.score.toFixed(3)} infer=${timing.total.toFixed(1)}ms (tok ${timing.tokenize.toFixed(1)} / enc ${timing.encode.toFixed(1)} / mlp ${timing.mlp.toFixed(1)}) reqTotal=${(performance.now() - __reqT0).toFixed(0)}ms`,
    );
    if (!decision.ok) {
      const rejection = describeModerationDecision(decision, prompt);
      if (rejection.shouldLog) {
        await logBraintrustFailure(
          {
            name: "blinkshot.generate-image",
            type: "llm",
            event: {
              metadata: {
                route: "/api/moderate",
                phase: "moderation",
                success: false,
                ...rejection.logMetadata,
              },
            },
          },
          new Error(`prompt rejected: ${rejection.logMetadata.rejectionReason}`),
        );
        await flushBraintrust();
      }
      // Return the score so the preview trigger test can confirm the model is
      // actually running (not a stub). The image route will return a 400 body that
      // surfaces through the existing toast path instead.
      return Response.json(
        { ok: false, score: decision.score, threshold: decision.threshold },
        { status: 400 },
      );
    }

    return Response.json(
      { ok: true, score: decision.score, threshold: decision.threshold },
      { status: 200 },
    );
  } catch (error) {
    await logBraintrustFailure(
      {
        name: "blinkshot.generate-image",
        type: "llm",
        event: {
          metadata: {
            route: "/api/moderate",
            phase: "request-validation",
            success: false,
          },
        },
      },
      error,
    );
    await flushBraintrust();
    return Response.json({ error: String(error) }, { status: 400 });
  }
}