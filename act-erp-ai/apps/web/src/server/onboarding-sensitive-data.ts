import { encryptSensitiveJson, decryptSensitiveJson } from "./sensitive-data";

/** All packet JSON is sensitive: applications include license and background data. */
export const ONBOARDING_PACKET_FIELDS = [
  "application",
  "drugAlcohol",
  "background",
  "directDeposit",
  "handbook",
] as const;

export type OnboardingPacketField = (typeof ONBOARDING_PACKET_FIELDS)[number];
type PacketFields = Record<OnboardingPacketField, unknown>;

export function onboardingPacketContext(inviteId: string, field: OnboardingPacketField) {
  return { purpose: "onboarding-packet", recordId: inviteId, field };
}

export function onboardingDraftContext(inviteId: string) {
  return { purpose: "onboarding-draft", recordId: inviteId, field: "draftJson" };
}

/** Call before file uploads and before opening a database transaction. */
export async function encryptOnboardingPacketFields(inviteId: string, packet: PacketFields) {
  const entries = await Promise.all(
    ONBOARDING_PACKET_FIELDS.map(async (field) => [
      field,
      await encryptSensitiveJson(packet[field], onboardingPacketContext(inviteId, field)),
    ] as const),
  );
  return Object.fromEntries(entries) as Record<
    OnboardingPacketField,
    Awaited<ReturnType<typeof encryptSensitiveJson>>
  >;
}

/** Only call after authorization; plaintext must stay on the server. */
export async function decryptOnboardingPacketFields<T extends PacketFields>(
  inviteId: string,
  packet: T,
): Promise<T> {
  const entries = await Promise.all(
    ONBOARDING_PACKET_FIELDS.map(async (field) => [
      field,
      await decryptSensitiveJson(packet[field], onboardingPacketContext(inviteId, field)),
    ] as const),
  );
  return { ...packet, ...Object.fromEntries(entries) };
}
