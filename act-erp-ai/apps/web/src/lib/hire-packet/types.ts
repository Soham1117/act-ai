/** Confidence for a single extracted field proposal. */
export type FieldConfidence = "high" | "medium" | "low";

export type ProposedField = {
  value: string;
  confidence: FieldConfidence;
  sourceFile: string;
  sourceForm: HirePacketFormType;
};

export type HirePacketFormType =
  | "I9"
  | "W4"
  | "DRIVERS_LICENSE"
  | "DIRECT_DEPOSIT"
  | "OFFER_LETTER"
  | "UNKNOWN";

/** Keys map to `updateEmployee` scalar fields (string/date enums as strings). */
export type HirePacketProposals = Partial<
  Record<
    | "name"
    | "phoneNumber"
    | "dateOfBirth"
    | "address"
    | "city"
    | "state"
    | "zipCode"
    | "emergencyName"
    | "emergencyPhone"
    | "nationality"
    | "ssnLast4"
    | "maritalStatus"
    | "jobTitle"
    | "dateOfHire"
    | "workEmail"
    | "personalEmail",
    ProposedField
  >
>;

export type HirePacketFileResult = {
  fileName: string;
  documentId: string;
  formType: HirePacketFormType;
  textSource: "digital" | "textract";
  warnings: string[];
};

export const HIRE_PACKET_FIELD_LABELS: Record<keyof HirePacketProposals, string> = {
  name: "Full name",
  phoneNumber: "Phone",
  dateOfBirth: "Date of birth",
  address: "Street address",
  city: "City",
  state: "State",
  zipCode: "Zip code",
  emergencyName: "Emergency contact name",
  emergencyPhone: "Emergency contact phone",
  nationality: "Nationality / citizenship",
  ssnLast4: "SSN — last 4 only",
  maritalStatus: "Marital status",
  jobTitle: "Job title",
  dateOfHire: "Date of hire",
  workEmail: "Work email",
  personalEmail: "Personal email",
};

export const HIRE_PACKET_FIELD_GROUPS: {
  title: string;
  fields: (keyof HirePacketProposals)[];
}[] = [
  {
    title: "Personal",
    fields: [
      "name",
      "phoneNumber",
      "dateOfBirth",
      "address",
      "city",
      "state",
      "zipCode",
      "emergencyName",
      "emergencyPhone",
      "nationality",
      "ssnLast4",
      "maritalStatus",
      "personalEmail",
    ],
  },
  {
    title: "Work",
    fields: ["jobTitle", "dateOfHire", "workEmail"],
  },
];

export const MAX_HIRE_ZIP_BYTES = 50 * 1024 * 1024;
export const MAX_HIRE_ZIP_FILES = 30;
export const MIN_DIGITAL_TEXT_CHARS = 200;
