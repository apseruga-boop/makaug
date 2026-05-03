# MakaUg Performance Audit

Generated: 2026-05-03T03:44:40.125Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.

Slowest route: `/` at 1131ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | 200 | 1131 | 1535 | 1555 | 15 | 1 | 1 | no | 0 | pass |
| `/to-rent` | 200 | 838 | 836 | 849 | 19 | 1 | 1 | no | 0 | pass |
| `/for-sale` | 200 | 1071 | 1541 | 1550 | 33 | 8 | 1 | yes | 0 | pass |
| `/land` | 200 | 749 | 720 | 727 | 33 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | 200 | 865 | 878 | 910 | 34 | 8 | 1 | yes | 0 | pass |
| `/commercial` | 200 | 824 | 799 | 805 | 34 | 8 | 1 | yes | 0 | pass |
| `/brokers` | 200 | 834 | 816 | 824 | 33 | 8 | 1 | yes | 0 | pass |
| `/list-property` | 200 | 966 | 979 | 1029 | 34 | 9 | 1 | yes | 0 | pass |
| `/advertise` | 200 | 1128 | 1278 | 1282 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
