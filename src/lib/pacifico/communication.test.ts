import { describe, expect, it } from "vitest";
import { getChangedMessagingUsernames } from "./communication.ts";

describe("communication preference updates", () => {
  it("does not resubmit unchanged usernames", () => {
    const usernames = { discord: "aly", telegram: "aly_tg", signal: "+15551234567" };
    expect(getChangedMessagingUsernames(usernames, usernames)).toEqual({});
  });

  it("submits every changed username, including a cleared value", () => {
    expect(getChangedMessagingUsernames(
      { discord: "new-discord", telegram: "", signal: "+15551234567" },
      { discord: "old-discord", telegram: "old-telegram", signal: "+15551234567" },
    )).toEqual({
      discordUsername: "new-discord",
      telegramUsername: "",
    });
  });
});
