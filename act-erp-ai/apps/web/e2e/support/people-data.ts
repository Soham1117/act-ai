/**
 * Constants for the admin "people management" specs (slot 3). Pure data: the
 * seed part imports this too, so keep Playwright imports out of here.
 */
export const PEOPLE_PASSWORD = "Pp-People-Pass-1!";
/** Prefix on every employee / user a spec creates through the UI; purged after the spec. */
export const NEW_PREFIX = "ppnew";
export const NEW_EMAIL_DOMAIN = "ppnew.e2e.test";
export const DEFAULT_PIN = "3214";
export const CUSTOM_PIN = "5827";

type Person = { employeeId: string; name: string; email: string };
const person = (n: string, name: string): Person => ({
  employeeId: `PPL-${n}`,
  name,
  email: `${name.split(" ")[0]!.toLowerCase()}@pp.e2e.test`,
});

export const PEOPLE = {
  edith: person("0001", "Edith Editable"), // inline-edit tests
  terry: person("0002", "Terry Terminate"), // terminate / reactivate / login effects
  bulkA: person("0003", "Bella Bulk"), // bulk terminate
  bulkB: person("0004", "Boris Bulk"), // bulk terminate
  bulkC: person("0005", "Cleo Cleanup"), // terminated, no history: bulk delete
  bulkD: person("0006", "Dexter History"), // active with hours: bulk delete needs force
  paula: person("0007", "Paula Password"), // admin password reset
  pinn: person("0008", "Pinn Reset"), // kiosk PIN reset (custom PIN 5827)
  pico: person("0009", "Pico Picture"), // profile picture upload
  supa: person("0010", "Sven Supervisor"), // supervisor loop tests
  supb: person("0011", "Sara Subordinate"),
  rory: person("0012", "Rory Roleplay"), // promote / demote admin
  pend1: person("0013", "Penny Pending"), // approve a pending hire
  pend2: person("0014", "Percy Pending"), // reject a pending hire
  jcA: person("0015", "Jules Jobcode"), // job code assignment
  jcB: person("0016", "Jade Jobcode"),
  hp1: person("0017", "Hugo Hirepacket"), // hire packet import
  hp2: person("0018", "Hana Hirepacket"),
  dept: person("0019", "Dana Deptmember"), // member of the staffed department
  onleave: person("0020", "Olive Onleave"), // ON_LEAVE (not on kiosk roster)
} as const;

export const DEPTS = {
  staffed: { name: "E2E Staffed Dept", code: "PPST" },
  empty: { name: "E2E Empty Dept", code: "PPEM" },
  invite: { name: "E2E Invite Dept", code: "PPIN" },
} as const;

export const CODES = {
  a: { code: "PPJC1", title: "People Welding" },
  b: { code: "PPJC2", title: "People Assembly" },
  del: { code: "PPJCDEL", title: "People Deletable" },
  used: { code: "PPJCUSE", title: "People In Use" },
} as const;
