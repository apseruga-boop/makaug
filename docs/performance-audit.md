# MakaUg Performance Audit

Generated: 2026-05-03T05:23:55.112Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/brokers` (mobile) at 592ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 532 | 529 | 1189 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 237 | 148 | 157 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 295 | 157 | 179 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 235 | 140 | 149 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 283 | 189 | 226 | 36 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 224 | 138 | 146 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 220 | 129 | 140 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 249 | 166 | 223 | 34 | 2 | 2 | no | 0 | pass |
| `/advertise` | desktop | 200 | 175 | 116 | 120 | 24 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 217 | 144 | 152 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 185 | 117 | 123 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 206 | 130 | 138 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 208 | 136 | 144 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 228 | 140 | 149 | 27 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 201 | 126 | 135 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 248 | 163 | 175 | 30 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 220 | 157 | 165 | 26 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 592 | 309 | 322 | 27 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 314 | 234 | 279 | 26 | 2 | 2 | no | 0 | pass |
| `/advertise` | mobile | 200 | 213 | 131 | 136 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 268 | 173 | 183 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 212 | 131 | 138 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
