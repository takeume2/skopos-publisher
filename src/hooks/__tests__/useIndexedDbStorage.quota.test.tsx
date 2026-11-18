import { describe, it, expect, vi } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";

vi.mock("idb-keyval", async () => {
  const actual = await vi.importActual<typeof import("idb-keyval")>(
    "idb-keyval"
  );
  return {
    ...actual,
    set: vi.fn(async (key: IDBValidKey, value: unknown) => {
      if (String(key).startsWith("mdpub:shared_asset:")) {
        const err = new Error("Quota exceeded");
        err.name = "QuotaExceededError";
        throw err;
      }
      return actual.set(key, value);
    }),
  };
});

import { useIndexedDbStorage } from "@/hooks/useIndexedDbStorage";

describe("useIndexedDbStorage QuotaExceededError handling", () => {
  it("sets storageError when QuotaExceededError occurs and clears it on dismiss", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { result } = renderHook(() => useIndexedDbStorage());
    await waitFor(() => expect(result.current.isLoaded).toBe(true));

    await act(async () => {
      await result.current.saveAsset(
        "asset:shared_logo_999",
        "data:image/png;base64,BIG_DATA"
      );
    });

    expect(result.current.storageError).toContain("QuotaExceededError");

    act(() => {
      result.current.clearStorageError();
    });

    expect(result.current.storageError).toBeNull();
    spy.mockRestore();
  });
});
