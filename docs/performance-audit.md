# MakaUg Performance Audit

Generated: 2026-05-04T04:14:50.018Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/advertise` (desktop) at 1217ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1033 | 1399 | 1425 | 18 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 687 | 673 | 1637 | 33 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 917 | 1354 | 1363 | 34 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 923 | 1379 | 1388 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 795 | 829 | 861 | 39 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 833 | 819 | 827 | 38 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 842 | 810 | 818 | 34 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 698 | 709 | 730 | 27 | 7 | 1 | yes | 0 | pass |
| `/advertise` | desktop | 200 | 1217 | 1655 | 1659 | 17 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 1107 | 1550 | 1559 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 982 | 947 | 952 | 16 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 685 | 680 | 689 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 725 | 691 | 704 | 27 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 1026 | 1489 | 1497 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 952 | 1358 | 1367 | 26 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 953 | 1444 | 1456 | 30 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 914 | 1355 | 1363 | 25 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 674 | 654 | 660 | 25 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 713 | 700 | 728 | 29 | 7 | 1 | yes | 0 | pass |
| `/advertise` | mobile | 200 | 941 | 1366 | 1370 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 704 | 686 | 694 | 18 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 773 | 737 | 742 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
