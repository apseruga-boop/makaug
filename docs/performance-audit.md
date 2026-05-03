# MakaUg Performance Audit

Generated: 2026-05-03T06:30:38.478Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 757ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 757 | 747 | 1411 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 227 | 149 | 173 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 313 | 185 | 208 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 182 | 130 | 138 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 310 | 223 | 277 | 37 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 317 | 224 | 233 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 334 | 275 | 287 | 31 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 264 | 167 | 225 | 35 | 2 | 2 | no | 0 | pass |
| `/advertise` | desktop | 200 | 187 | 125 | 129 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 229 | 214 | 229 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 206 | 156 | 161 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 258 | 180 | 188 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 261 | 157 | 166 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 213 | 140 | 150 | 27 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 181 | 129 | 137 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 266 | 175 | 188 | 31 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 187 | 136 | 144 | 26 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 435 | 305 | 313 | 27 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 254 | 241 | 303 | 27 | 2 | 2 | no | 0 | pass |
| `/advertise` | mobile | 200 | 217 | 137 | 141 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 268 | 197 | 206 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 199 | 143 | 149 | 18 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
