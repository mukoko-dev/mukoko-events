import { describe, it, expect, vi, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { ServiceWorkerRegister } from "@/components/pwa/sw-register";

type Listener = (event?: unknown) => void;

function createEventTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: vi.fn((type: string, cb: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(cb);
    }),
    removeEventListener: vi.fn((type: string, cb: Listener) => {
      listeners.get(type)?.delete(cb);
    }),
    emit(type: string, event?: unknown) {
      listeners.get(type)?.forEach((cb) => cb(event));
    },
  };
}

/**
 * The component registers /sw.js in production and actively checks for
 * updates; NODE_ENV=test counts as "not production" only for the negative
 * test, which stubs development explicitly.
 */
function installMockContainer({
  controller = {} as object | null,
  update = vi.fn().mockResolvedValue(undefined),
} = {}) {
  const registration = { update, ...createEventTarget() };
  const container = {
    register: vi.fn().mockResolvedValue(registration),
    controller,
    ...createEventTarget(),
  };
  Object.defineProperty(window.navigator, "serviceWorker", {
    value: container,
    configurable: true,
  });
  return { container, registration };
}

function removeMockContainer() {
  delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
}

describe("ServiceWorkerRegister", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    removeMockContainer();
  });

  it("does not register outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const { container } = installMockContainer();
    render(<ServiceWorkerRegister />);
    await act(async () => {});
    expect(container.register).not.toHaveBeenCalled();
  });

  it("registers /sw.js in production and checks for an update on mount", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
    const { container, registration } = installMockContainer();
    render(<ServiceWorkerRegister />);

    await waitFor(() =>
      expect(container.register).toHaveBeenCalledWith("/sw.js"),
    );
    // The mount-time check is the fix: a PWA left open across a deploy, or a
    // kiosk unit, picks the release up without a navigation.
    await waitFor(() => expect(registration.update).toHaveBeenCalledTimes(1));
  });

  it("checks again on becoming visible and on focus, but not when hidden", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
    const { registration } = installMockContainer();
    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(registration.update).toHaveBeenCalled());

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(registration.update).toHaveBeenCalledTimes(2);

    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(registration.update).toHaveBeenCalledTimes(3);
  });

  it("reloads exactly once on a genuine controller swap", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
    });
    const { container } = installMockContainer({ controller: {} });

    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    act(() => container.emit("controllerchange"));
    act(() => container.emit("controllerchange"));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("never reloads for the first install's claim (no controller at load)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    Object.defineProperty(document, "readyState", {
      value: "complete",
      configurable: true,
    });
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, reload },
      configurable: true,
    });
    const { container } = installMockContainer({ controller: null });

    render(<ServiceWorkerRegister />);
    await waitFor(() => expect(container.register).toHaveBeenCalled());

    act(() => container.emit("controllerchange"));
    expect(reload).not.toHaveBeenCalled();
  });
});
