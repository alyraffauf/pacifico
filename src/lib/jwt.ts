import type { PrivateKey } from "@atcute/crypto";
import { toBase64Url } from "@atcute/multibase";

function encodeJson(value: unknown): string {
  return toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

export async function signJwt(
  key: PrivateKey,
  header: Record<string, unknown>,
  payload: Record<string, unknown>,
): Promise<string> {
  const headerEncoded = encodeJson(header);
  const payloadEncoded = encodeJson(payload);
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = await key.sign(new TextEncoder().encode(signingInput));
  return `${signingInput}.${toBase64Url(signature)}`;
}
