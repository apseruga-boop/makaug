# MakaUg Performance Audit

Generated: 2026-05-03T04:39:05.810Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/mortgage` at 1292ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | 200 | 968 | 975 | 1114 | 16 | 1 | 1 | no | 0 | pass |
| `/to-rent` | 200 | 917 | 893 | 902 | 29 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | 200 | 786 | 780 | 814 | 40 | 8 | 1 | yes | 0 | pass |
| `/land` | 200 | 798 | 764 | 771 | 43 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | 200 | 1112 | 1556 | 1611 | 51 | 9 | 1 | yes | 0 | pass |
| `/commercial` | 200 | 1011 | 1547 | 1555 | 50 | 9 | 1 | yes | 0 | pass |
| `/brokers` | 200 | 1070 | 1505 | 1514 | 38 | 8 | 1 | yes | 0 | pass |
| `/list-property` | 200 | 913 | 890 | 3659 | 58 | 10 | 1 | yes | 0 | pass |
| `/advertise` | 200 | 1189 | 1605 | 1609 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | 200 | 1292 | 1639 | 1648 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | 200 | 891 | 851 | 856 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
