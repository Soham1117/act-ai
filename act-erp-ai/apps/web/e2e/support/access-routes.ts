/**
 * The data-driven route table for access-routes.spec.ts and smoke.spec.ts.
 * To cover a new page or API route, add ONE line to PAGES or APIS below.
 *
 * Who:
 *  - anon      no session
 *  - employee  Erin (normal active employee; owns the "Erin" files)
 *  - grace     Gina, terminated 10 days ago (60-day read-only grace window)
 *  - ended     Edna: had a valid session, then her access ended (terminated 200 days ago)
 *  - admin     the base admin
 *
 * Outcome (what a client sees WITHOUT following redirects):
 *  - "ok"            HTTP 200
 *  - "login"         redirect to /login?next=<this path>      (the Proxy: no session cookie)
 *  - "login-plain"   redirect to /login with no next          (page guard: cookie ok, session dead)
 *  - "unauthorized"  redirect to /unauthorized                 (signed in, wrong role)
 *  - "->/x"          redirect to /x
 *  - a number        that HTTP status (API routes answer with statuses, not redirects). Pages
 *                    rendering the not-found screen (robots noindex) count as 404 even when
 *                    the HTTP status is 200 (pages under a loading.tsx stream, so the status
 *                    line is already sent).
 */
export type Who = "anon" | "employee" | "grace" | "ended" | "admin";
export const WHO: Who[] = ["anon", "employee", "grace", "ended", "admin"];
export type Outcome = "ok" | "login" | "login-plain" | "unauthorized" | `->${string}` | number;

export type RouteRow = {
  kind: "page" | "api";
  method?: "GET" | "POST";
  /** May contain {tokens}, resolved in the spec (see TOKENS in access-routes.spec.ts). */
  path: string;
  expect: Record<Who, Outcome>;
  /** Smoke test: open this page as this role in a real browser (pages only). */
  smoke?: "admin" | "employee" | "anon";
  /** Smoke test: the page is intentionally a "Page not found" (feature off). */
  smokeNotFound?: boolean;
  /** Extra text a successful body must contain (API file routes: which file came back). */
  bodyContains?: Partial<Record<Who, string>>;
};

type Over = Partial<Record<Who, Outcome>>;

/** Admin-only page. */
const adminPage = (path: string, over: Over = {}, extra: Partial<RouteRow> = {}): RouteRow => ({
  kind: "page",
  path,
  smoke: "admin",
  expect: { anon: "login", employee: "unauthorized", grace: "unauthorized", ended: "login-plain", admin: "ok", ...over },
  ...extra,
});

/** Page for any signed-in user (grace-window users may VIEW). */
const userPage = (path: string, over: Over = {}, extra: Partial<RouteRow> = {}): RouteRow => ({
  kind: "page",
  path,
  smoke: "employee",
  expect: { anon: "login", employee: "ok", grace: "ok", ended: "login-plain", admin: "ok", ...over },
  ...extra,
});

/** Page anyone can open. */
const publicPage = (path: string, over: Over = {}, extra: Partial<RouteRow> = {}): RouteRow => ({
  kind: "page",
  path,
  smoke: "anon",
  expect: { anon: "ok", employee: "ok", grace: "ok", ended: "ok", admin: "ok", ...over },
  ...extra,
});

/** API route: pass the outcome per role. */
const api = (
  path: string,
  expect: Record<Who, Outcome>,
  extra: Partial<RouteRow> = {},
): RouteRow => ({ kind: "api", path, expect, ...extra });

// AI is off in the E2E environment (AI_ENABLED=false): chat + knowledge pages show
// "Page not found". Admin pages for non-admins still redirect first (layout guard).
const AI_OFF_ADMIN: Over = { admin: 404 };
const AI_OFF_USER: Over = { employee: 404, grace: 404, admin: 404 };

export const PAGES: RouteRow[] = [
  // ── Admin (src/app/(admin)/admin) ──
  adminPage("/admin"),
  adminPage("/admin/activity"),
  adminPage("/admin/benefits"),
  adminPage("/admin/chat", AI_OFF_ADMIN, { smokeNotFound: true }),
  adminPage("/admin/contract-workers"),
  adminPage("/admin/contract-workers/{cw}"),
  adminPage("/admin/departments"),
  adminPage("/admin/departments/{dept}"),
  adminPage("/admin/documents"),
  adminPage("/admin/employees"),
  adminPage("/admin/employees/{erin}"),
  adminPage("/admin/employees/{erin}/hire-import/{hire}"),
  adminPage("/admin/job-codes"),
  adminPage("/admin/job-codes/{job}"),
  adminPage("/admin/kiosks"),
  adminPage("/admin/knowledge", AI_OFF_ADMIN, { smokeNotFound: true }),
  adminPage("/admin/leave"),
  adminPage("/admin/notifications"),
  adminPage("/admin/onboarding"),
  adminPage("/admin/payroll"),
  adminPage("/admin/payroll/{period}"),
  adminPage("/admin/reimbursements"),
  adminPage("/admin/requests"),
  adminPage("/admin/schedules"),
  adminPage("/admin/settings"),
  adminPage("/admin/time-tracking"),
  // ids that do not exist: admin gets the 404 page, everyone else the usual redirect
  adminPage("/admin/employees/no-such-employee", { admin: 404 }, { smoke: undefined }),
  adminPage("/admin/departments/no-such-department", { admin: 404 }, { smoke: undefined }),
  adminPage("/admin/job-codes/no-such-code", { admin: 404 }, { smoke: undefined }),
  adminPage("/admin/payroll/no-such-period", { admin: 404 }, { smoke: undefined }),
  adminPage("/admin/contract-workers/no-such-worker", { admin: 404 }, { smoke: undefined }),

  // ── Employee (src/app/(employee)/dashboard) ──
  userPage("/dashboard"),
  userPage("/dashboard/benefits"),
  userPage("/dashboard/chat", AI_OFF_USER, { smokeNotFound: true }),
  userPage("/dashboard/documents"),
  userPage("/dashboard/leave"),
  userPage("/dashboard/my-details", { admin: 404 }),
  userPage("/dashboard/notifications"),
  userPage("/dashboard/payroll"),
  userPage("/dashboard/reimbursements"),
  userPage("/dashboard/requests"),
  userPage("/dashboard/schedule"),
  userPage("/dashboard/settings"),
  userPage("/dashboard/team"),
  userPage("/dashboard/time-tracking"),

  // ── Auth, onboarding, notices ──
  // "/" sends signed-in users home and everyone else to the plain login page.
  {
    kind: "page",
    path: "/",
    expect: { anon: "login-plain", employee: "->/dashboard", grace: "->/dashboard", ended: "login-plain", admin: "->/admin" },
  },
  // /login bounces signed-in users home; a dead session just sees the form.
  publicPage("/login", { employee: "->/dashboard", grace: "->/dashboard", admin: "->/admin" }, { smoke: "anon" }),
  publicPage("/onboard"),
  publicPage("/onboard/{invite}"),
  publicPage("/onboard/{inviteExpired}"),
  publicPage("/onboard/no-such-token", { anon: 404, employee: 404, grace: 404, ended: 404, admin: 404 }, { smoke: undefined }),
  publicPage("/unauthorized"),
  publicPage("/privacy"),
  publicPage("/auth/forgot-password"),
  // The forced-password page: only for sessions that must change their password.
  {
    kind: "page",
    path: "/change-password",
    expect: { anon: "login", employee: "->/dashboard", grace: "->/dashboard", ended: "login-plain", admin: "->/admin" },
  },

  // ── Kiosk ──
  // Index is admin-only; a terminal page is public to the Proxy but sends a
  // device with no kiosk cookie to the login page (admin: activation card).
  // (a dead session on the kiosk pages is sent to /login?next=<kiosk path>)
  adminPage("/kiosk", { ended: "login" }, { smoke: "admin" }),
  {
    kind: "page",
    path: "/kiosk/{newKiosk}",
    smoke: undefined,
    expect: { anon: "login", employee: "unauthorized", grace: "unauthorized", ended: "login", admin: "ok" },
  },
  {
    kind: "page",
    path: "/kiosk/no-such-kiosk",
    expect: { anon: 404, employee: 404, grace: 404, ended: 404, admin: 404 },
  },

  // ── Unknown URLs: the Proxy asks anonymous users to sign in first ──
  {
    kind: "page",
    path: "/no-such-page",
    expect: { anon: "login", employee: 404, grace: 404, ended: 404, admin: 404 },
  },
];

const FILE_NEEDS_SESSION = "login" as const;

export const APIS: RouteRow[] = [
  // Health + NextAuth are public (Proxy PUBLIC_PATHS).
  api("/api/health", { anon: "ok", employee: "ok", grace: "ok", ended: "ok", admin: "ok" }),
  api("/api/auth/session", { anon: "ok", employee: "ok", grace: "ok", ended: "ok", admin: "ok" }),
  api("/api/auth/csrf", { anon: "ok", employee: "ok", grace: "ok", ended: "ok", admin: "ok" }),
  // Customer-portal identity adapter: public to the Proxy, HMAC-authenticated inside.
  api("/api/v1/identity/jwks", { anon: 503, employee: 503, grace: 503, ended: 503, admin: 503 }),
  api(
    "/api/v1/identity/begin",
    // Unsigned POST: 503 "IDENTITY_UNAVAILABLE" because no service secret is configured in E2E.
    { anon: 503, employee: 503, grace: 503, ended: 503, admin: 503 },
    { method: "POST" },
  ),

  // Unread badge: a dead session just gets zero, never data.
  api("/api/notifications/unread", { anon: FILE_NEEDS_SESSION, employee: "ok", grace: "ok", ended: "ok", admin: "ok" }),

  // AI assistant is off: the route answers 503 before it looks at the session.
  api("/api/chat", { anon: FILE_NEEDS_SESSION, employee: 503, grace: 503, ended: 503, admin: 503 }, { method: "POST" }),
  api("/api/knowledge/some-id/file", { anon: FILE_NEEDS_SESSION, employee: 404, grace: 404, ended: 404, admin: 404 }),
  api("/api/knowledge/some-id/view", { anon: FILE_NEEDS_SESSION, employee: 404, grace: 404, ended: 404, admin: 404 }),

  // Documents: owner + admin only. "ended" = dead session = 401.
  api("/api/documents/{docErin}/file", { anon: "login", employee: "ok", grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { employee: "documents/acc-erin-doc.pdf", admin: "documents/acc-erin-doc.pdf" },
  }),
  api("/api/documents/{docOther}/file", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { admin: "documents/acc-other-doc.pdf" },
  }),
  api("/api/documents/{docGrace}/file", { anon: "login", employee: 403, grace: "ok", ended: 401, admin: "ok" }, {
    bodyContains: { grace: "documents/acc-grace-doc.pdf" },
  }),
  api("/api/documents/no-such-doc/file", { anon: "login", employee: 404, grace: 404, ended: 401, admin: 404 }),

  // Payslips.
  api("/api/payroll/{payErin}/file", { anon: "login", employee: "ok", grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { employee: "payroll/acc-erin-stub.pdf", admin: "payroll/acc-erin-stub.pdf" },
  }),
  api("/api/payroll/{payOther}/file", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { admin: "payroll/acc-other-stub.pdf" },
  }),
  api("/api/payroll/{payGrace}/file", { anon: "login", employee: 403, grace: "ok", ended: 401, admin: "ok" }, {
    bodyContains: { grace: "payroll/acc-grace-stub.pdf" },
  }),
  api("/api/payroll/no-such-stub/file", { anon: "login", employee: 404, grace: 404, ended: 401, admin: 404 }),

  // Reimbursement receipts.
  api("/api/reimbursements/receipts/{rcptErin}/file", { anon: "login", employee: "ok", grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { employee: "reimbursement-receipts/acc-erin-receipt.pdf" },
  }),
  api("/api/reimbursements/receipts/{rcptOther}/file", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }, {
    bodyContains: { admin: "reimbursement-receipts/acc-other-receipt.pdf" },
  }),
  api("/api/reimbursements/receipts/no-such-receipt/file", { anon: "login", employee: 404, grace: 404, ended: 401, admin: 404 }),

  // Avatars: any signed-in user may view any avatar (team page); never anonymous.
  api("/api/employees/{erin}/profile-pic", { anon: "login", employee: "ok", grace: "ok", ended: 401, admin: "ok" }),
  api("/api/employees/no-such-employee/profile-pic", { anon: "login", employee: 404, grace: 404, ended: 401, admin: 404 }),

  // Punch photos: ADMIN ONLY.
  api("/api/punch-photo?type=employee&id={entryPhoto}&side=in", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }),
  api("/api/punch-photo?type=contract&id={contractEntryPhoto}&side=in", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }),
  api("/api/punch-photo?type=employee&id={entryNoPhoto}&side=in", { anon: "login", employee: 403, grace: 403, ended: 401, admin: 404 }),
  api("/api/punch-photo?type=employee&id={entryPhoto}&side=out", { anon: "login", employee: 403, grace: 403, ended: 401, admin: 404 }),
  api("/api/punch-photo?type=bogus&id={entryPhoto}&side=in", { anon: "login", employee: 403, grace: 403, ended: 401, admin: 400 }),
  api("/api/punch-photo", { anon: "login", employee: 403, grace: 403, ended: 401, admin: 400 }),

  // Admin CSV export of the audit log (lives under the (admin) group but is a route handler).
  api("/admin/activity/export", { anon: "login", employee: 403, grace: 403, ended: 401, admin: "ok" }),
];

/** "/admin/x?y=1" -> "/admin/x" (the Proxy puts only the pathname in `next`). */
export const pathnameOf = (p: string) => p.split("?")[0]!;
