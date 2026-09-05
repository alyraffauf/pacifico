import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useCallback } from "react";
import { useAsync } from "./useAsync.ts";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function useTestAsync(load: () => Promise<string>) {
  return useAsync(useCallback(() => load(), [load]));
}

describe("useAsync", () => {
  it("loads immediately and reloads on demand", async () => {
    const load = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("first")
      .mockResolvedValueOnce("second");
    const { result } = renderHook(() => useTestAsync(load));

    await waitFor(() => expect(result.current.data).toBe("first"));

    await act(async () => {
      await result.current.reload();
    });

    expect(result.current.data).toBe("second");
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("ignores a stale response from an earlier request", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useTestAsync(load));

    act(() => {
      void result.current.reload();
    });
    await act(async () => {
      second.resolve("newer");
      await second.promise;
    });
    await waitFor(() => expect(result.current.data).toBe("newer"));

    await act(async () => {
      first.resolve("older");
      await first.promise;
    });

    expect(result.current.data).toBe("newer");
  });

  it("ignores a response after unmount", async () => {
    const pending = deferred<string>();
    const load = vi
      .fn<() => Promise<string>>()
      .mockReturnValue(pending.promise);
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const { unmount } = renderHook(() => useTestAsync(load));

    unmount();
    await act(async () => {
      pending.resolve("late");
      await pending.promise;
    });

    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
