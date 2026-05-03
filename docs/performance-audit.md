# MakaUg Performance Audit

Generated: 2026-05-03T04:32:19.241Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` at 550ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | 200 | 550 | 550 | 1227 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | 200 | 212 | 136 | 145 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | 200 | 207 | 130 | 148 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | 200 | 184 | 123 | 131 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | 200 | 239 | 164 | 193 | 36 | 2 | 2 | no | 0 | pass |
| `/commercial` | 200 | 255 | 168 | 176 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | 200 | 191 | 165 | 174 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | 200 | 263 | 176 | 237 | 37 | 2 | 2 | no | 0 | pass |
| `/advertise` | 200 | 189 | 142 | 146 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | 200 | 227 | 145 | 153 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | 200 | 185 | 118 | 124 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
