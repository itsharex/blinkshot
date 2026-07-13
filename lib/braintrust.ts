import {
  initLogger,
  type Logger,
  type Span,
  type StartSpanArgs,
} from "braintrust";

let logger: Logger<true> | null | undefined;

export function getBraintrustLogger() {
  if (!process.env.BRAINTRUST_API_KEY) return undefined;

  if (logger !== undefined) {
    return logger ?? undefined;
  }

  try {
    logger = initLogger({
      apiKey: process.env.BRAINTRUST_API_KEY,
      projectName: process.env.BRAINTRUST_PROJECT ?? "blinkshot",
      asyncFlush: true,
    });
  } catch (error) {
    logger = null;
    console.warn("Braintrust logger initialization failed:", error);
  }

  return logger ?? undefined;
}

export async function flushBraintrust() {
  try {
    await logger?.flush();
  } catch (error) {
    console.warn("Braintrust flush failed:", error);
  }
}

export async function logBraintrustFailure(
  args: StartSpanArgs,
  error: unknown,
) {
  try {
    const span = getBraintrustLogger()?.startSpan({
      ...args,
      event: {
        ...args.event,
        error: serializeBraintrustError(error),
      },
    });
    span?.end();
    await span?.flush();
  } catch (loggingError) {
    console.warn("Braintrust failure logging failed:", loggingError);
  }
}

export function serializeBraintrustError(
  error: unknown,
  sensitiveValues: Array<string | undefined> = [],
) {
  const redact = (value: string | undefined) => {
    if (value === undefined) return undefined;

    let redacted = value;
    for (const sensitiveValue of sensitiveValues) {
      if (sensitiveValue) {
        redacted = redacted.replaceAll(sensitiveValue, "[REDACTED]");
      }
    }
    return redacted;
  };

  if (error instanceof Error) {
    return {
      name: error.name,
      message: redact(error.message),
      stack: redact(error.stack),
    };
  }

  return { message: redact(String(error)) };
}

export type { Span };
