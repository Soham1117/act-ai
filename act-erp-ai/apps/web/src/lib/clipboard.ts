export type ClipboardWriter = {
  writeText(text: string): Promise<void>;
};

export type CopyTextResult =
  | { ok: true }
  | { ok: false; error: string };

export const MANUAL_COPY_GUIDANCE =
  "Copy failed. Select the link and copy it manually.";

/** Copy text only when the Clipboard API is available and confirms success. */
export async function copyText(
  text: string,
  clipboard: ClipboardWriter | undefined = globalThis.navigator?.clipboard,
): Promise<CopyTextResult> {
  if (!clipboard) return { ok: false, error: MANUAL_COPY_GUIDANCE };
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    return { ok: false, error: MANUAL_COPY_GUIDANCE };
  }
}
