# MakaUg Performance Audit

Generated: 2026-05-04T12:23:10.631Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1189ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1189 | 1537 | 2152 | 17 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 923 | 1418 | 1431 | 20 | 1 | 1 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 677 | 715 | 729 | 20 | 1 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 754 | 745 | 759 | 33 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 938 | 1486 | 1533 | 38 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 701 | 921 | 934 | 33 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 679 | 686 | 702 | 37 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 957 | 1504 | 1548 | 30 | 7 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 921 | 1377 | 1386 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 690 | 707 | 723 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 699 | 708 | 716 | 16 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1043 | 1457 | 1478 | 21 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 683 | 692 | 706 | 26 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 988 | 1407 | 1419 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 917 | 1402 | 1415 | 25 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 674 | 905 | 937 | 30 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 673 | 1179 | 1189 | 26 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 699 | 708 | 719 | 26 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 931 | 1440 | 1471 | 30 | 7 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 913 | 1396 | 1404 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 975 | 1438 | 1454 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 938 | 1429 | 1437 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
