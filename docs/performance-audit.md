# MakaUg Performance Audit

Generated: 2026-05-03T12:05:37.331Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 991ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 991 | 994 | 1639 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 195 | 110 | 119 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 181 | 104 | 126 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 174 | 98 | 106 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 258 | 146 | 161 | 37 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 174 | 106 | 115 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 196 | 109 | 126 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 195 | 121 | 164 | 31 | 2 | 2 | no | 0 | pass |
| `/advertise` | desktop | 200 | 145 | 84 | 88 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 218 | 140 | 150 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 164 | 87 | 92 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 164 | 100 | 109 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 172 | 98 | 105 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 173 | 94 | 102 | 27 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 216 | 128 | 137 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 195 | 119 | 131 | 31 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 151 | 92 | 99 | 26 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 173 | 96 | 104 | 27 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 183 | 113 | 152 | 32 | 2 | 2 | no | 0 | pass |
| `/advertise` | mobile | 200 | 170 | 94 | 98 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 193 | 112 | 121 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 151 | 86 | 91 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
