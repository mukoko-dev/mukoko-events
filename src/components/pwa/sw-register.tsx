"use client";

import { useEffect } from "react";

/**
 * Registers /sw.js in production and keeps the installed PWA on the current
 * release (the mukoko-weather model):
 *
 * - The deploy identity is IN the script bytes (scripts/inject-sw-version.mjs
 *   writes it into the generated public/sw.js) and /sw.js is served
 *   `Cache-Control: no-store` (next.config.ts), so an update check
 *   byte-compares fresh content.
 * - On mount, whenever the document becomes visible again, and on focus, it
 *   calls registration.update() — an installed PWA that stays open, or a
 *   kiosk/signage unit, would otherwise keep the build it booted with until
 *   the browser's own navigation check happened to run.
 * - The worker skipWaiting()s on install, so a new release fires
 *   controllerchange; a one-time guarded reload then lands the user on the
 *   new build exactly once. The guard skips the FIRST controllerchange (the
 *   initial registration's clients.claim) so a first visit never reloads.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof window === "undefined" || !("serviceWorker" in navigator))
      return;

    const container = navigator.serviceWorker;
    let registration: ServiceWorkerRegistration | null = null;

    // Snapshot whether a controller already existed at page load: with
    // skipWaiting + clients.claim, the first visit fires a controllerchange
    // for the INITIAL claim. That one must not reload.
    const hadControllerAtLoad = Boolean(container.controller);

    let reloaded = false;
    const onControllerChange = () => {
      if (reloaded) return;
      if (!hadControllerAtLoad) return;
      reloaded = true;
      try {
        window.location.reload();
      } catch {
        // best-effort — reload never breaks the app
      }
    };

    // Ask the browser to re-check /sw.js for a newer worker.
    const checkForUpdate = () => {
      try {
        registration?.update().catch(() => {
          // best-effort
        });
      } catch {
        // best-effort — some browsers throw synchronously when unsupported
      }
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") checkForUpdate();
    };

    const register = () => {
      container
        .register("/sw.js")
        .then((reg) => {
          registration = reg;
          // Check once on registration so a PWA left open across a deploy
          // picks it up without waiting for a visibility/focus event.
          checkForUpdate();
        })
        .catch(() => {
          // Registration failed (unsupported / blocked) — the app still
          // works online.
        });
    };

    if (document.readyState === "complete") {
      register();
    } else {
      window.addEventListener("load", register, { once: true });
    }

    container.addEventListener("controllerchange", onControllerChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("focus", checkForUpdate);

    return () => {
      container.removeEventListener("controllerchange", onControllerChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", checkForUpdate);
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
