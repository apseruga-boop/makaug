# MakaUg Performance Audit

Generated: 2026-05-03T03:13:40.311Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.

Slowest route: `/` at 544ms.

| Route | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | 200 | 544 | 487 | 1169 | 25 | 2 | 2 | no | 0 | pass |
| `/to-rent` | 200 | 254 | 142 | 152 | 34 | 2 | 2 | no | 0 | pass |
| `/for-sale` | 200 | 210 | 129 | 148 | 33 | 2 | 2 | no | 0 | pass |
| `/land` | 200 | 202 | 123 | 132 | 44 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | 200 | 273 | 172 | 187 | 37 | 2 | 2 | no | 0 | pass |
| `/commercial` | 200 | 207 | 136 | 145 | 32 | 2 | 2 | no | 0 | pass |
| `/brokers` | 200 | 194 | 123 | 132 | 36 | 2 | 2 | no | 0 | pass |
| `/list-property` | 200 | 252 | 158 | 186 | 45 | 2 | 2 | no | 0 | pass |
| `/advertise` | 200 | 175 | 114 | 117 | 21 | 2 | 2 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
