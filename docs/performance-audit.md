# MakaUg Performance Audit

Generated: 2026-05-03T08:14:50.917Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 526ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 526 | 527 | 1206 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 227 | 148 | 156 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 206 | 143 | 195 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 199 | 139 | 148 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 330 | 236 | 285 | 37 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 320 | 201 | 209 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 282 | 182 | 193 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 196 | 183 | 247 | 35 | 2 | 2 | no | 0 | pass |
| `/advertise` | desktop | 200 | 202 | 130 | 134 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 232 | 148 | 158 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 201 | 123 | 128 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 245 | 159 | 170 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 261 | 151 | 162 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 195 | 138 | 147 | 28 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 200 | 135 | 143 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 240 | 147 | 159 | 31 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 198 | 143 | 151 | 26 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 181 | 127 | 135 | 27 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 227 | 152 | 198 | 27 | 2 | 2 | no | 0 | pass |
| `/advertise` | mobile | 200 | 179 | 119 | 123 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 195 | 136 | 143 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 199 | 122 | 127 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
