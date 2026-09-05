import { describe, expect, it } from "vitest";
import { pdsEndpointFromDid } from "./registration.ts";

describe("PDS endpoint discovery", () => {
  it("uses the authority from a did:web server DID", () => {
    expect(pdsEndpointFromDid("did:web:aly.social", "localhost"))
      .toBe("https://aly.social");
  });

  it("decodes an encoded development port", () => {
    expect(pdsEndpointFromDid("did:web:localhost%3A3000", "localhost"))
      .toBe("https://localhost:3000");
  });

  it("falls back to the supplied public hostname", () => {
    expect(pdsEndpointFromDid("did:plc:example", "pds.example.com"))
      .toBe("https://pds.example.com");
  });
});
