import { getPdsEndpoint } from "@atcute/identity";
import {
  DohJsonHandleResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";
import type { DidDocument } from "./types.ts";

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (did.startsWith("did:plc:")) {
    const resolver = new PlcDidDocumentResolver({ fetch });
    return resolver.resolve(
      did as Parameters<typeof resolver.resolve>[0],
    ) as Promise<DidDocument>;
  }

  if (did.startsWith("did:web:")) {
    const resolver = new WebDidDocumentResolver({ fetch });
    return resolver.resolve(
      did as Parameters<typeof resolver.resolve>[0],
    ) as Promise<DidDocument>;
  }

  throw new Error(`Unsupported DID method: ${did}`);
}

export async function resolvePdsUrl(
  handleOrDid: string,
): Promise<{ did: string; pdsUrl: string }> {
  let did: string | undefined;

  if (handleOrDid.startsWith("did:")) {
    did = handleOrDid;
  } else {
    const handle = handleOrDid.replace(/^@/, "");

    if (handle.endsWith(".bsky.social")) {
      const resolver = new XrpcHandleResolver({
        serviceUrl: "https://public.api.bsky.app",
        fetch,
      });
      did = await resolver.resolve(
        handle as Parameters<typeof resolver.resolve>[0],
      );
    } else {
      const dnsResolver = new DohJsonHandleResolver({
        dohUrl: "https://dns.google/resolve",
        fetch,
      });
      try {
        did = await dnsResolver.resolve(
          handle as Parameters<typeof dnsResolver.resolve>[0],
        );
      } catch {
        const wellKnownResolver = new WellKnownHandleResolver({ fetch });
        try {
          did = await wellKnownResolver.resolve(
            handle as Parameters<typeof wellKnownResolver.resolve>[0],
          );
        } catch {
          throw new Error(`Could not resolve handle: ${handle}`);
        }
      }
    }
  }

  if (!did) {
    throw new Error("Could not resolve DID");
  }

  const didDoc = await resolveDidDocument(did);

  const pdsUrl = getPdsEndpoint(didDoc as Parameters<typeof getPdsEndpoint>[0]);
  if (!pdsUrl) {
    throw new Error("No PDS service found in DID document");
  }

  return { did, pdsUrl };
}
