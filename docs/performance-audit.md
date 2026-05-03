# MakaUg Performance Audit

Generated: 2026-05-03T06:45:16.663Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/advertise` (desktop) at 1334ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1092 | 1096 | 1222 | 16 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 1202 | 1630 | 1640 | 21 | 1 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 946 | 914 | 927 | 35 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 952 | 931 | 938 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 962 | 986 | 1018 | 40 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 1191 | 1621 | 1630 | 34 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 1154 | 1667 | 1676 | 36 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 1228 | 1622 | 3548 | 60 | 10 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 1334 | 1767 | 1772 | 16 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 1164 | 1133 | 1142 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 994 | 953 | 958 | 16 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1015 | 991 | 999 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 892 | 862 | 869 | 26 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 1187 | 1564 | 1573 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 1198 | 1631 | 1640 | 26 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 1110 | 1092 | 1103 | 30 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 900 | 872 | 878 | 25 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 961 | 919 | 927 | 26 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 989 | 973 | 1184 | 49 | 10 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 916 | 889 | 891 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 1193 | 1612 | 1620 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 1194 | 1598 | 1605 | 16 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
