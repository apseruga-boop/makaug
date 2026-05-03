# MakaUg Performance Audit

Generated: 2026-05-03T05:49:01.739Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/to-rent` (desktop) at 1311ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1276 | 1657 | 1679 | 18 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 1311 | 1681 | 1693 | 29 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 1126 | 1556 | 1566 | 35 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 1274 | 1716 | 1726 | 35 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 1096 | 1573 | 1588 | 43 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 909 | 889 | 898 | 45 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 962 | 939 | 948 | 38 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 899 | 886 | 2708 | 59 | 10 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 904 | 865 | 870 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 848 | 835 | 844 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 928 | 881 | 885 | 17 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1190 | 1659 | 1671 | 21 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 1131 | 1603 | 1612 | 27 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 967 | 916 | 925 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 985 | 952 | 960 | 26 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 982 | 953 | 964 | 29 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 913 | 884 | 891 | 25 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 1101 | 1521 | 1533 | 26 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 906 | 885 | 950 | 47 | 10 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 910 | 864 | 868 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 1159 | 1560 | 1569 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 1111 | 1536 | 1543 | 16 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
