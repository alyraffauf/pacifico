import { getPdsEndpoint } from "@atcute/identity";
import {
  DohJsonHandleResolver,
  PlcDidDocumentResolver,
  WebDidDocumentResolver,
  WellKnownHandleResolver,
  XrpcHandleResolver,
} from "@atcute/identity-resolver";
import type { DidDocument } from "./types.ts";

type PlcDid = Parameters<PlcDidDocumentResolver["resolve"]>[0];
type WebDid = Parameters<WebDidDocumentResolver["resolve"]>[0];
type AtprotoHandle = Parameters<XrpcHandleResolver["resolve"]>[0];
type AtcuteDidDocument = Parameters<typeof getPdsEndpoint>[0];

const asPlcDid = (did: string): PlcDid => did as PlcDid;
const asWebDid = (did: string): WebDid => did as WebDid;
const asHandle = (handle: string): AtprotoHandle => handle as AtprotoHandle;
const asMigrationDidDocument = (document: unknown): DidDocument =>
  document as DidDocument;
const asAtcuteDidDocument = (document: DidDocument): AtcuteDidDocument =>
  document as AtcuteDidDocument;

export async function resolveDidDocument(did: string): Promise<DidDocument> {
  if (did.startsWith("did:plc:")) {
    const resolver = new PlcDidDocumentResolver({ fetch });
    return asMigrationDidDocument(await resolver.resolve(asPlcDid(did)));
  }

  if (did.startsWith("did:web:")) {
    const resolver = new WebDidDocumentResolver({ fetch });
    return asMigrationDidDocument(await resolver.resolve(asWebDid(did)));
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
      did = await resolver.resolve(asHandle(handle));
    } else {
      const dnsResolver = new DohJsonHandleResolver({
        dohUrl: "https://dns.google/resolve",
        fetch,
      });
      try {
        did = await dnsResolver.resolve(asHandle(handle));
      } catch {
        const wellKnownResolver = new WellKnownHandleResolver({ fetch });
        try {
          did = await wellKnownResolver.resolve(asHandle(handle));
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

  const pdsUrl = getPdsEndpoint(asAtcuteDidDocument(didDoc));
  if (!pdsUrl) {
    throw new Error("No PDS service found in DID document");
  }

  return { did, pdsUrl };
}
