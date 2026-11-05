import type { FaceDetector } from "@mediapipe/tasks-vision";

// Pinned to the installed package version so the WASM never drifts from the JS.
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/wasm";
// BlazeFace short-range (~230 KB): detection only, no recognition.
const MODEL_URL = "/models/blaze_face_short_range.tflite";

let loading: Promise<FaceDetector | null> | null = null;

/**
 * Lazily load the on-device face detector once per page. Resolves null if it
 * cannot load (offline CDN, old browser), so callers can fail open.
 */
export function loadFaceDetector(): Promise<FaceDetector | null> {
  loading ??= (async () => {
    try {
      const { FilesetResolver, FaceDetector } = await import("@mediapipe/tasks-vision");
      const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
      return await FaceDetector.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: MODEL_URL, delegate: "CPU" },
        runningMode: "IMAGE",
        minDetectionConfidence: 0.75,
      });
    } catch {
      loading = null; // allow a retry on the next punch
      return null;
    }
  })();
  return loading;
}
