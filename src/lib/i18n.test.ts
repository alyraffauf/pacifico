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
    "renders the About description without a key or placeholder in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("about.description");
      const loadFailed = translate("about.loadFailed");

      expect(description).not.toBe("about.description");
      expect(loadFailed).not.toBe("about.loadFailed");
      expect(`${description} ${loadFailed}`).not.toMatch(/[{}]/);
    },
  );

  it.each(supportedLocales)(
    "renders the Security description without a key or placeholder in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("security.description");

      expect(description).not.toBe("security.description");
      expect(description).not.toMatch(/[{}]/);
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

  it.each(supportedLocales)(
    "renders Invite Code dialog copy without raw keys in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("inviteCodes.description");
      const createdDescription = translate("inviteCodes.createdDescription");
      const usedStatus = translate("inviteCodes.usedStatus");

      expect(description).not.toBe("inviteCodes.description");
      expect(createdDescription).not.toBe("inviteCodes.createdDescription");
      expect(usedStatus).not.toBe("inviteCodes.usedStatus");
      expect(`${description} ${createdDescription} ${usedStatus}`).not.toMatch(
        /[{}]/,
      );
    },
  );

  it.each(supportedLocales)(
    "renders Communication preferences without raw keys in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("comms.description");
      const channelDescription = translate(
        "comms.channelConfigurationDescription",
      );
      const verification = translate("comms.verifyDescription", {
        identifier: "alice",
      });

      expect(description).not.toBe("comms.description");
      expect(channelDescription).not.toBe(
        "comms.channelConfigurationDescription",
      );
      expect(verification).toContain("alice");
      expect(
        `${description} ${channelDescription} ${verification}`,
      ).not.toMatch(/[{}]/);
    },
  );

  it.each(supportedLocales)(
    "renders Delegation settings without raw keys in %s",
    async (locale) => {
      localStorage.setItem("tranquil-pds-locale", locale);
      await initializeI18n();

      const description = translate("delegation.description");
      const grantedOn = translate("delegation.grantedOn", {
        date: "2026-09-05",
      });
      const accountCreated = translate("delegation.accountCreated", {
        handle: "alice.example.com",
      });

      expect(description).not.toBe("delegation.description");
      expect(grantedOn).toContain("2026-09-05");
      expect(accountCreated).toContain("alice.example.com");
      expect(`${description} ${grantedOn} ${accountCreated}`).not.toMatch(
        /[{}]/,
      );
    },
  );
});
