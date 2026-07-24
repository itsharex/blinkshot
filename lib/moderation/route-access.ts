export function isModerationProbeEnabled({
  nodeEnv,
  vercelEnv,
}: {
  nodeEnv: string | undefined;
  vercelEnv: string | undefined;
}) {
  if (vercelEnv === "production") return false;
  if (vercelEnv === "preview") return true;
  return nodeEnv === "development";
}
