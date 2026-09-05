import { describe, expect, it } from "vitest";
import {
  approvedConsentScopes,
  initialConsentSelections,
  updateConsentSelection,
  type ConsentData,
} from "./consent.ts";

const consent: ConsentData = {
  request_uri: "urn:request:test",
  client_name: "Test client",
  client_uri: null,
  show_consent: true,
  transition_supersedes: true,
  scopes: [
    {
      scope: "atproto",
      category: "Core",
      required: true,
      description: "Core access",
      display_name: "AT Protocol",
      granted: null,
    },
    {
      scope: "transition:generic",
      category: "Transition",
      required: false,
      description: "Transition access",
      display_name: "Transition",
      granted: false,
    },
    {
      scope: "repo:app.bsky.feed.post",
      category: "Repository",
      required: false,
      description: "Posts",
      display_name: "Posts",
      granted: false,
      superseded: true,
    },
    {
      scope: "account:email",
      category: "Account",
      required: false,
      description: "Email",
      display_name: "Email",
      granted: false,
      restricted: true,
    },
  ],
  permission_sets: [
    {
      include_scope: "include:example.permissions",
      title: "Example",
      granted: false,
      superseded: true,
    },
  ],
};

describe("OAuth consent selections", () => {
  it("always selects required scopes and omits restricted scopes", () => {
    const selections = initialConsentSelections(consent);
    expect(selections.atproto).toBe(true);
    expect(selections["account:email"]).toBeUndefined();
  });

  it("selects superseded scopes when generic transition access is enabled", () => {
    const selections = updateConsentSelection(
      consent,
      initialConsentSelections(consent),
      "transition:generic",
      true,
    );

    expect(selections["repo:app.bsky.feed.post"]).toBe(true);
    expect(selections["include:example.permissions"]).toBe(true);
  });

  it("uses the AT Protocol fallback for an empty consent request", () => {
    expect(
      approvedConsentScopes(
        { ...consent, scopes: [], permission_sets: [] },
        {},
      ),
    ).toEqual(["atproto"]);
  });
});
