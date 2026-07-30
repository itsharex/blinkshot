import assert from "node:assert/strict";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import test from "node:test";
import Together from "together-ai";

test("Together transport does not depend on legacy node-fetch", async () => {
  const require = createRequire(import.meta.url);
  const packageRoot = dirname(require.resolve("together-ai"));
  const packageJson = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  ) as { dependencies?: Record<string, string> };

  assert.equal(
    packageJson.dependencies?.["node-fetch"],
    undefined,
    "node-fetch@2 calls deprecated url.parse() in bundled Next.js routes",
  );
});

test("Together image transport preserves the generation request", async () => {
  const server = createServer((request, response) => {
    assert.equal(request.method, "POST");
    assert.equal(request.url, "/images/generations");

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        data: [{ b64_json: "fake-image" }],
      }),
    );
  });

  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const address = server.address();
  assert.ok(address && typeof address !== "string");

  try {
    const client = new Together({
      apiKey: "test-api-key",
      baseURL: `http://127.0.0.1:${address.port}`,
    });

    await client.images.generate({
      prompt: "A lighthouse",
      model: "black-forest-labs/FLUX.1-schnell",
      width: 1024,
      height: 768,
      steps: 3,
      response_format: "base64",
    });
  } finally {
    server.close();
    await once(server, "close");
  }
});
