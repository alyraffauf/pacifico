import { afterEach, describe, expect, it } from "vitest";
import { applySiteIcon, getSiteIconPath } from "./site.ts";

describe("applySiteIcon", () => {
  afterEach(() => {
    document.head.replaceChildren();
  });

  it("uses the configured server logo for browser icons", () => {
    document.head.innerHTML = `
      <link rel="icon" href="/site-mark.png">
      <link rel="apple-touch-icon" href="/site-mark.png">
    `;

    applySiteIcon("bafkreiexample");

    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/favicon.ico?v=bafkreiexample",
    );
    expect(
      document.querySelector('link[rel="apple-touch-icon"]'),
    ).toHaveAttribute("href", "/favicon.ico?v=bafkreiexample");
  });

  it("restores the bundled icon when no server logo is configured", () => {
    document.head.innerHTML = '<link rel="icon" href="/favicon.ico">';

    applySiteIcon(null);

    expect(document.querySelector('link[rel="icon"]')).toHaveAttribute(
      "href",
      "/site-mark.png",
    );
  });
});

describe("getSiteIconPath", () => {
  it("escapes the logo CID used to invalidate the browser cache", () => {
    expect(getSiteIconPath("logo cid")).toBe("/favicon.ico?v=logo%20cid");
  });
});
