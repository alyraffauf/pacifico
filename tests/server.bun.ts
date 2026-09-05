import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequestHandler } from "../server.ts";

let distributionDirectory = "";

beforeAll(async () => {
  distributionDirectory = await mkdtemp(
    join(tmpdir(), "pacifico-server-test-"),
  );
  await Bun.write(
    join(distributionDirectory, "index.html"),
    "<title>__FRONTEND_HOSTNAME__</title><main>Pacifico</main>",
  );
  await Bun.write(
    join(distributionDirectory, "oauth-client-metadata.json"),
    '{"client_id":"https://__FRONTEND_HOSTNAME__/oauth-client-metadata.json"}',
  );
  await Bun.write(
    join(distributionDirectory, "assets/app-abc123.js"),
    "export {};",
  );
});

afterAll(async () => {
  if (distributionDirectory.startsWith(tmpdir())) {
    await rm(distributionDirectory, { recursive: true, force: true });
  }
});

function handler(publicOrigin = "https://pds.example.com") {
  return createRequestHandler({ distributionDirectory, publicOrigin });
}

describe("Pacifico server", () => {
  it("applies the enforced security policy to HTML", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/app/settings"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("content-security-policy")).toContain(
      "script-src 'self'",
    );
    expect(response.headers.get("content-security-policy")).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.text()).toContain("<title>pds.example.com</title>");
  });

  it("substitutes the hostname when index.html is requested directly", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/index.html"),
    );
    expect(await response.text()).toContain("<title>pds.example.com</title>");
  });

  it("uses the configured origin in OAuth client metadata", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/oauth-client-metadata.json"),
    );

    expect(await response.json()).toEqual({
      client_id: "https://pds.example.com/oauth-client-metadata.json",
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a mismatched host", async () => {
    const response = await handler()(
      new Request("https://attacker.example/oauth-client-metadata.json"),
    );
    expect(response.status).toBe(421);
  });

  it("only serves files with GET and HEAD", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/assets/app-abc123.js", {
        method: "POST",
      }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  it("caches hashed assets as immutable", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/assets/app-abc123.js"),
    );
    expect(response.headers.get("cache-control")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("rejects malformed encoded paths", async () => {
    const response = await handler()(
      new Request("https://pds.example.com/%E0%A4%A"),
    );
    expect(response.status).toBe(400);
  });

  it("allows direct pod health probes without relaxing public host validation", async () => {
    const response = await handler()(
      new Request("http://127.0.0.1:3000/healthz"),
    );
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok");
    expect(response.headers.get("content-security-policy")).not.toBeNull();

    const publicResponse = await handler()(
      new Request("http://127.0.0.1:3000/app/settings"),
    );
    expect(publicResponse.status).toBe(421);

    const writeResponse = await handler()(
      new Request("http://127.0.0.1:3000/healthz", {
        method: "POST",
      }),
    );
    expect(writeResponse.status).toBe(405);
  });
});
