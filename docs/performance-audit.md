# MakaUg Performance Audit

Generated: 2026-05-03T06:35:21.083Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/advertise` (desktop) at 1491ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1054 | 1056 | 1230 | 17 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 1259 | 1229 | 1237 | 30 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 873 | 848 | 905 | 39 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 1120 | 1580 | 1589 | 42 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 1041 | 1056 | 1126 | 53 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 933 | 913 | 921 | 46 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 864 | 850 | 860 | 40 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 1343 | 1622 | 1681 | 38 | 9 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 1491 | 1462 | 1466 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 1048 | 1038 | 1046 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 1171 | 1143 | 1147 | 16 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1150 | 1637 | 1647 | 21 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 1110 | 1106 | 1112 | 26 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 1269 | 1668 | 1676 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 1215 | 1569 | 1579 | 25 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 1172 | 1377 | 1388 | 29 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 900 | 860 | 867 | 26 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 1180 | 1149 | 1156 | 25 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 939 | 936 | 1001 | 49 | 10 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 855 | 820 | 823 | 16 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 1114 | 1546 | 1555 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 949 | 908 | 913 | 16 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
