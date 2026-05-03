# MakaUg Performance Audit

Generated: 2026-05-03T03:42:20.636Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.

Slowest route: `/land` at 1128ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | 200 | 984 | 984 | 1122 | 18 | 1 | 1 | no | 0 | pass |
| `/to-rent` | 200 | 862 | 835 | 842 | 18 | 1 | 1 | no | 0 | pass |
| `/for-sale` | 200 | 850 | 821 | 1169 | 33 | 8 | 1 | yes | 0 | pass |
| `/land` | 200 | 1128 | 1625 | 1634 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | 200 | 796 | 816 | 869 | 42 | 8 | 1 | yes | 0 | pass |
| `/commercial` | 200 | 866 | 842 | 850 | 38 | 8 | 1 | yes | 0 | pass |
| `/brokers` | 200 | 1015 | 1527 | 1537 | 34 | 8 | 1 | yes | 0 | pass |
| `/list-property` | 200 | 849 | 844 | 903 | 35 | 9 | 1 | yes | 0 | pass |
| `/advertise` | 200 | 882 | 833 | 837 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
