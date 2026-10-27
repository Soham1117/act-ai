# Employee portal language preference

| Item | Scenario | Status | Spec |
|---|---|---|---|
| `setPortalLanguage` | authenticated preference update, anonymous pending choice, invalid language, pending-choice application at login, and failed persistence | covered | `src/server/portal-language-preference.test.ts` |
| `setPortalLanguage` | employee portal language switch and translated page reload in a browser | planned | manual browser verification; dedicated Playwright flow not written |
| `kioskUpdateProfilePhoto` | device/person/PIN guards, successful profile photo update, and validation failures | covered | `src/server/kiosk-profile-photo-actions.test.ts` |
| `kioskContractUpdateProfilePhoto` | contract-session guards and successful profile photo update | covered | `src/server/kiosk-profile-photo-actions.test.ts` |
