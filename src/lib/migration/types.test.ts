import { describe, expect, test } from "vitest";
import { MigrationError, getErrorMessage } from "./types.ts";

describe("MigrationError", () => {
  test("retains structured error details", () => {
    const error = new MigrationError(
      "Source PDS unavailable",
      "ERR_NETWORK",
      true,
      { status: 503 },
    );

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("MigrationError");
    expect(error.code).toBe("ERR_NETWORK");
    expect(error.recoverable).toBe(true);
    expect(error.details).toEqual({ status: 503 });
  });

  test("normalizes unknown thrown values", () => {
    expect(getErrorMessage(new Error("broken"))).toBe("broken");
    expect(getErrorMessage("broken")).toBe("broken");
  });
});
