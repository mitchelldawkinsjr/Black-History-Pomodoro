/** Build-time / packaged API origin for Black History Pomodoro. */
export const API_BASE_URL = 'https://blackhistory.360web.cloud';

export const MAX_DISCOVERY_BREAKS = 10;
export const SEEN_DISCOVERY_LIMIT = 300;

/**
 * Prefer same-origin when this module runs on an http(s) page (screensaver PWA).
 * Extension service workers stay on the packaged API origin.
 */
export function resolveApiBaseUrl() {
  try {
    const origin = globalThis.location?.origin;
    if (
      typeof origin === 'string'
      && /^https?:\/\//i.test(origin)
      && !/^chrome-extension:/i.test(globalThis.location?.protocol ?? '')
    ) {
      return origin;
    }
  } catch {
    // ignore
  }
  return API_BASE_URL;
}
