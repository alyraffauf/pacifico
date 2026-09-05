import { readJson } from "../http.ts";

export async function denyAuthorization(
  requestUri: string,
  send: (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => Promise<Response> = fetch,
): Promise<string> {
  const response = await send("/oauth/authorize/deny", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ request_uri: requestUri }),
  });
  const result = await readJson<{ redirect_uri?: string }>(response);
  if (!result.redirect_uri) {
    throw new Error("The authorization server returned no redirect.");
  }
  return result.redirect_uri;
}
