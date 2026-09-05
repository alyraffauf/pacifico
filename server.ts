import { join, normalize } from "node:path";

const securityHeaders = {
  "content-security-policy": [
    "default-src 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' https: data: blob:",
    "font-src 'self'",
    "connect-src 'self' https:",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; "),
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": [
    "camera=()",
    "microphone=()",
    "geolocation=()",
    "payment=()",
    "usb=()",
    "publickey-credentials-create=(self)",
    "publickey-credentials-get=(self)",
    "clipboard-write=(self)",
  ].join(", "),
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
} as const;

interface ServerOptions {
  distributionDirectory: string;
  publicOrigin?: string;
}

function addHeaders(
  response: Response,
  headers: Record<string, string>,
): Response {
  const mergedHeaders = new Headers(response.headers);
  for (const [name, value] of Object.entries(headers))
    mergedHeaders.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: mergedHeaders,
  });
}

function responseWithSecurityHeaders(response: Response): Response {
  return addHeaders(response, securityHeaders);
}

function resolvePublicFile(
  distributionDirectory: string,
  pathname: string,
): string | null {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  const relativePath = normalize(decodedPath).replace(/^[/\\]+/, "");
  const resolvedPath = join(distributionDirectory, relativePath);
  return resolvedPath.startsWith(`${distributionDirectory}/`)
    ? resolvedPath
    : null;
}

function cacheControlFor(pathname: string): string {
  if (pathname.startsWith("/assets/"))
    return "public, max-age=31536000, immutable";
  return "no-store";
}

function resolvePublicOrigin(requestUrl: URL, configuredOrigin?: string): URL {
  if (!configuredOrigin) return new URL(requestUrl.origin);

  const publicOrigin = new URL(configuredOrigin);
  if (
    publicOrigin.protocol !== "https:" &&
    publicOrigin.hostname !== "localhost"
  ) {
    throw new Error("PUBLIC_ORIGIN must use HTTPS");
  }
  return publicOrigin;
}

export function createRequestHandler(options: ServerOptions) {
  const indexFile = Bun.file(join(options.distributionDirectory, "index.html"));
  const indexHtml = indexFile.text();
  const oauthClientMetadataFile = Bun.file(
    join(options.distributionDirectory, "oauth-client-metadata.json"),
  );

  async function serveIndex(
    method: string,
    hostname: string,
  ): Promise<Response> {
    const html = (await indexHtml).replaceAll(
      "__FRONTEND_HOSTNAME__",
      hostname,
    );
    return responseWithSecurityHeaders(
      new Response(method === "HEAD" ? null : html, {
        headers: {
          "cache-control": "no-store",
          "content-type": "text/html; charset=utf-8",
        },
      }),
    );
  }

  return async function handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Kubernetes probes address the pod directly, so their Host header cannot
    // match the public ingress origin. Keep this exact endpoint independent of
    // public host validation while validating every browser-facing route.
    if (url.pathname === "/healthz") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return responseWithSecurityHeaders(
          new Response("Method not allowed", {
            status: 405,
            headers: { allow: "GET, HEAD", "cache-control": "no-store" },
          }),
        );
      }
      return responseWithSecurityHeaders(
        new Response(request.method === "HEAD" ? null : "ok", {
          headers: {
            "cache-control": "no-store",
            "content-type": "text/plain; charset=utf-8",
          },
        }),
      );
    }

    let publicOrigin: URL;
    try {
      publicOrigin = resolvePublicOrigin(url, options.publicOrigin);
    } catch (caught) {
      const message =
        caught instanceof Error
          ? caught.message
          : "Invalid server configuration";
      return responseWithSecurityHeaders(
        new Response(message, { status: 500 }),
      );
    }

    if (options.publicOrigin && url.host !== publicOrigin.host) {
      return responseWithSecurityHeaders(
        new Response("Misdirected request", { status: 421 }),
      );
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return responseWithSecurityHeaders(
        new Response("Method not allowed", {
          status: 405,
          headers: { allow: "GET, HEAD", "cache-control": "no-store" },
        }),
      );
    }

    if (url.pathname === "/oauth-client-metadata.json") {
      const metadata = (await oauthClientMetadataFile.text()).replaceAll(
        "__FRONTEND_HOSTNAME__",
        publicOrigin.host,
      );
      return responseWithSecurityHeaders(
        new Response(request.method === "HEAD" ? null : metadata, {
          headers: {
            "cache-control": "no-store",
            "content-type": "application/json; charset=utf-8",
          },
        }),
      );
    }

    if (url.pathname === "/index.html") {
      return serveIndex(request.method, publicOrigin.hostname);
    }

    const publicPath = resolvePublicFile(
      options.distributionDirectory,
      url.pathname,
    );
    if (publicPath) {
      const publicFile = Bun.file(publicPath);
      if (await publicFile.exists()) {
        return responseWithSecurityHeaders(
          new Response(request.method === "HEAD" ? null : publicFile, {
            headers: {
              "cache-control": cacheControlFor(url.pathname),
              "content-type": publicFile.type,
            },
          }),
        );
      }
    } else if (url.pathname.includes("%")) {
      return responseWithSecurityHeaders(
        new Response("Malformed path", { status: 400 }),
      );
    }

    return serveIndex(request.method, publicOrigin.hostname);
  };
}

if (import.meta.main) {
  const port = Number(Bun.env.PORT || 3000);
  const publicOrigin = Bun.env.PUBLIC_ORIGIN?.trim() || undefined;
  const distributionDirectory = join(import.meta.dir, "dist");

  if (Bun.env.NODE_ENV === "production" && !publicOrigin) {
    throw new Error("PUBLIC_ORIGIN is required when NODE_ENV=production");
  }

  if (publicOrigin) {
    resolvePublicOrigin(new URL("http://localhost"), publicOrigin);
  }

  Bun.serve({
    port,
    fetch: createRequestHandler({ distributionDirectory, publicOrigin }),
  });

  console.info(`Pacifico listening on ${port}`);
}
