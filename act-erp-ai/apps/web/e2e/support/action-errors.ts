/**
 * Plain messages a user sees when a server action call itself throws (the
 * connection drops, the server answers 500, or the page is from an older
 * deploy). The app shows them as a toast and keeps the open dialog and the
 * typed values. See `runAction` / `toastCaught` in src/lib/toast-action.ts.
 */
export const NETWORK_ERROR = /could not reach the server\. check the connection and try again/i;
export const SERVER_ERROR = /the server had a problem. try again in a moment/i;
export const STALE_ERROR = /this page is out of date\. reload the page and try again/i;
