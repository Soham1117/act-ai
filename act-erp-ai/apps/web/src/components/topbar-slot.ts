import { useSyncExternalStore } from "react";

/** The #page-header-slot element in AppTopbar, once `query` matches (null on the server and below it). */
export function useTopbarSlot(query: string): HTMLElement | null {
  const matches = useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", cb);
      return () => mq.removeEventListener("change", cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
  return matches ? document.getElementById("page-header-slot") : null;
}
