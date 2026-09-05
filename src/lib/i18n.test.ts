import { afterEach, describe, expect, it } from "vitest";
import { initializeI18n, setLocale, translate } from "./i18n.ts";

describe("i18n", () => {
  afterEach(async () => {
    setLocale("en");
    await initializeI18n();
  });

  it("loads the selected Tranquil locale and interpolates values", async () => {
    localStorage.setItem("tranquil-pds-locale", "fr");
    await initializeI18n();

    expect(translate("common.cancel")).toBe("Annuler");
    expect(
      translate("inviteCodes.disableConfirm", { code: "invite-1" }),
    ).toContain("invite-1");
  });
});
