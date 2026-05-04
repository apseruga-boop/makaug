# MakaUg Performance Audit

Generated: 2026-05-04T12:12:40.726Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/for-sale` (mobile) at 487ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 483 | 1022 | 1716 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 268 | 170 | 185 | 34 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 265 | 149 | 163 | 30 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 220 | 137 | 149 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 312 | 170 | 212 | 38 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 221 | 132 | 144 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 217 | 129 | 143 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 284 | 186 | 247 | 32 | 2 | 2 | no | 0 | pass |
| `/advertise` | desktop | 200 | 209 | 130 | 139 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 234 | 139 | 157 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 184 | 116 | 126 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 269 | 181 | 198 | 23 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 224 | 159 | 174 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 487 | 267 | 287 | 28 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 239 | 140 | 151 | 27 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 273 | 163 | 195 | 32 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 207 | 129 | 140 | 26 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 209 | 118 | 132 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 227 | 152 | 200 | 34 | 2 | 2 | no | 0 | pass |
| `/advertise` | mobile | 200 | 204 | 131 | 139 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 207 | 129 | 145 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 187 | 122 | 132 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
