# MakaUg Performance Audit

Generated: 2026-05-03T05:31:10.047Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (mobile) at 1273ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1213 | 1637 | 1686 | 17 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 896 | 864 | 878 | 29 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 1182 | 1614 | 1624 | 32 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 1153 | 1649 | 1657 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 1131 | 1604 | 1615 | 40 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 905 | 868 | 875 | 47 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 837 | 821 | 833 | 38 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 945 | 938 | 3581 | 58 | 10 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 1174 | 1581 | 1586 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 874 | 839 | 847 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 949 | 908 | 912 | 14 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1273 | 1619 | 1628 | 21 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 937 | 861 | 869 | 27 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 998 | 965 | 974 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 953 | 912 | 920 | 26 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 864 | 848 | 860 | 30 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 1159 | 1603 | 1612 | 25 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 1176 | 1685 | 1695 | 26 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 1005 | 988 | 2254 | 49 | 10 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 1095 | 1515 | 1519 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 905 | 869 | 876 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 984 | 934 | 939 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
