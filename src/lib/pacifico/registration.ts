import type { ServerDescription } from "../types/api.ts";

export function pdsEndpointFromDid(serverDid: string, fallbackHostname: string): string {
  if (serverDid.startsWith("did:web:")) {
    const encodedAuthority = serverDid.slice("did:web:".length).split(":")[0];
    if (encodedAuthority) return `https://${decodeURIComponent(encodedAuthority)}`;
  }

  return `https://${fallbackHostname}`;
}

export function getPublicPdsEndpoint(server: ServerDescription): string {
  const configuredEndpoint = import.meta.env.VITE_PDS_URL?.trim();
  if (configuredEndpoint) return new URL(configuredEndpoint).origin;
  return pdsEndpointFromDid(server.did, globalThis.location.hostname);
}
