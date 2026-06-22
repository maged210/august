// Web Push — CLIENT side. Service-worker registration + the gesture-triggered
// enable flow. Pairs with lib/push.ts (server). Everything is browser-guarded so it
// no-ops during SSR. The VAPID PUBLIC key is inlined at build via NEXT_PUBLIC_.
//
// iOS reality baked in: on iPhone, push only works from the INSTALLED home-screen
// PWA (iOS 16.4+), so a Safari tab is reported as "ios-install" rather than enabled.

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const isBrowser = typeof window !== "undefined";

export type PushState = "unsupported" | "ios-install" | "default" | "denied" | "granted";

export type EnableResult =
  | { ok: true }
  | { ok: false; reason: "unsupported" | "ios-install" | "denied" | "config" | "error" };

function pushSupported(): boolean {
  return (
    isBrowser &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function isIos(): boolean {
  if (!isBrowser) return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports as MacIntel with a touch screen — catch it too.
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/** Running as an installed standalone PWA (home-screen app), not a browser tab. */
export function isStandalone(): boolean {
  if (!isBrowser) return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

/** iPhone/iPad in a Safari TAB — push can't work until "Add to Home Screen". */
export function isIosTabNeedingInstall(): boolean {
  if (!isIos()) return false; // desktop has no install-first restriction
  return !isStandalone() || !("PushManager" in window);
}

// base64url (VAPID public key) → Uint8Array. REQUIRED: Safari/WebKit (all iOS
// browsers) reject the raw string for applicationServerKey; pass THIS array, not
// its .buffer.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

let _swReg: Promise<ServiceWorkerRegistration> | null = null;

/** Register the service worker (idempotent), after load so it doesn't contend with
 *  critical resources. Safe to call on every mount. */
export function registerServiceWorker(): void {
  if (!isBrowser || !("serviceWorker" in navigator)) return;
  const go = () => {
    if (!_swReg) {
      _swReg = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
      _swReg.catch((e) => {
        console.warn("[push] service worker registration failed:", e);
        _swReg = null; // allow a later retry
      });
    }
  };
  if (document.readyState === "complete") go();
  else window.addEventListener("load", go, { once: true });
}

/** Current state for the enable-notifications control. */
export function getPushState(): PushState {
  if (!isBrowser) return "unsupported";
  if (isIosTabNeedingInstall()) return "ios-install"; // guide to install before "unsupported"
  if (!pushSupported()) return "unsupported";
  const p = Notification.permission;
  if (p === "granted") return "granted";
  if (p === "denied") return "denied";
  return "default";
}

/** Gesture-triggered: request permission, subscribe (reusing an existing sub), and
 *  POST it to the server. MUST be called from a click/tap handler. */
export async function enablePush(): Promise<EnableResult> {
  if (isIosTabNeedingInstall()) return { ok: false, reason: "ios-install" };
  if (!pushSupported()) return { ok: false, reason: "unsupported" };
  if (!VAPID_PUBLIC_KEY) return { ok: false, reason: "config" };

  let permission: NotificationPermission;
  try {
    permission = await Notification.requestPermission();
  } catch {
    return { ok: false, reason: "error" };
  }
  if (permission !== "granted") return { ok: false, reason: "denied" };

  try {
    if (!_swReg) _swReg = navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
    await _swReg;
    const reg = await navigator.serviceWorker.ready;
    // Dedupe: reuse an existing subscription if present.
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, // mandatory on Chromium; harmless elsewhere
        // Pass the Uint8Array VALUE (not .buffer). The cast only resolves TS 5.7's
        // Uint8Array<ArrayBufferLike> vs BufferSource generic mismatch.
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY) as BufferSource,
      });
    }
    const res = await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub.toJSON()), // { endpoint, expirationTime, keys:{p256dh,auth} }
    });
    if (!res.ok) return { ok: false, reason: "error" };
    return { ok: true };
  } catch (e) {
    console.warn("[push] enable failed:", e);
    return { ok: false, reason: "error" };
  }
}
