import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useResource } from "./use-resource";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

afterEach(() => {
  cleanup();
});

describe("useResource", () => {
  it("loads data successfully", async () => {
    const loader = vi.fn().mockResolvedValue("loaded");
    const { result } = renderHook(() => useResource(loader, []));

    expect(result.current.loading).toBe(true);
    expect(result.current.data).toBeNull();
    expect(result.current.error).toBeNull();

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBe("loaded");
    expect(result.current.error).toBeNull();
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("captures loader failures", async () => {
    const loader = vi.fn().mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useResource(loader, []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(result.current.data).toBeNull();
    expect(result.current.error).toBe("boom");
  });

  it("refetches when deps change", async () => {
    const loader = vi.fn((id: number) => Promise.resolve(`value-${id}`));
    const { result, rerender } = renderHook(
      ({ id }) => useResource(() => loader(id), [id]),
      { initialProps: { id: 1 } },
    );

    await waitFor(() => {
      expect(result.current.data).toBe("value-1");
    });

    rerender({ id: 2 });

    await waitFor(() => {
      expect(result.current.data).toBe("value-2");
    });

    expect(loader).toHaveBeenCalledTimes(2);
    expect(loader).toHaveBeenNthCalledWith(1, 1);
    expect(loader).toHaveBeenNthCalledWith(2, 2);
  });

  it("does not update state after unmount", async () => {
    const deferred = createDeferred<string>();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const loader = vi.fn(() => deferred.promise);
    const { unmount } = renderHook(() => useResource(loader, []));

    unmount();
    deferred.resolve("loaded");
    await Promise.resolve();

    expect(loader).toHaveBeenCalledTimes(1);
    expect(consoleError).not.toHaveBeenCalled();

    consoleError.mockRestore();
  });
});
