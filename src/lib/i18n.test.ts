import { afterEach, describe, expect, it } from "vitest";
import {
  initializeI18n,
  setLocale,
  supportedLocales,
  translate,
} from "./i18n.ts";

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

  it.each(supportedLocales)(
    "renders the General subtitle without a key or placeholder in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const subtitle = translate("settings.subtitle");

      expect(subtitle).not.toBe("settings.subtitle");
      expect(subtitle).not.toMatch(/[{}]/);
    },
  );

  it.each(supportedLocales)(
    "renders App Password copy and dates without raw keys in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("appPasswords.description");
      const createdOn = translate("appPasswords.createdOn", {
        date: "2026-09-05",
      });

      expect(description).not.toBe("appPasswords.description");
      expect(createdOn).toContain("2026-09-05");
      expect(`${description} ${createdOn}`).not.toMatch(/[{}]/);
    },
  );
});
