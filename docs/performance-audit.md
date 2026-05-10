# MakaUg Performance Audit

Generated: 2026-05-10T07:17:56.260Z

Base URL: http://127.0.0.1:5058

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1322ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1322 | 1628 | 1877 | 20 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 385 | 171 | 268 | 34 | 3 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 436 | 207 | 311 | 32 | 3 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 385 | 197 | 281 | 43 | 3 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 472 | 132 | 362 | 37 | 3 | 2 | no | 0 | pass |
| `/students` | desktop | 200 | 449 | 185 | 315 | 37 | 3 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 482 | 204 | 299 | 31 | 3 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 522 | 258 | 368 | 29 | 3 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 585 | 330 | 629 | 31 | 3 | 2 | no | 0 | pass |
| `/about` | desktop | 200 | 368 | 153 | 248 | 21 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 274 | 123 | 174 | 19 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 276 | 124 | 175 | 18 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 288 | 129 | 189 | 19 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 248 | 106 | 165 | 21 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 342 | 156 | 222 | 19 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 369 | 177 | 262 | 24 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 302 | 153 | 202 | 18 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 239 | 98 | 141 | 20 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 398 | 182 | 252 | 18 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 323 | 129 | 184 | 18 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 301 | 116 | 193 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 401 | 179 | 281 | 22 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 249 | 105 | 161 | 18 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 400 | 192 | 286 | 23 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 361 | 184 | 260 | 26 | 3 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 358 | 193 | 274 | 26 | 3 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 403 | 142 | 216 | 25 | 3 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 298 | 125 | 224 | 30 | 3 | 2 | no | 0 | pass |
| `/students` | mobile | 200 | 507 | 223 | 368 | 30 | 3 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 281 | 124 | 189 | 28 | 3 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 368 | 165 | 257 | 25 | 3 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 359 | 112 | 293 | 32 | 3 | 2 | no | 0 | pass |
| `/about` | mobile | 200 | 355 | 150 | 232 | 21 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 422 | 225 | 306 | 19 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 334 | 153 | 215 | 20 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 325 | 154 | 221 | 21 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 446 | 238 | 318 | 19 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 522 | 254 | 381 | 21 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 353 | 184 | 253 | 19 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 321 | 162 | 207 | 18 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 346 | 177 | 239 | 18 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 333 | 158 | 208 | 18 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 233 | 102 | 149 | 20 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 304 | 108 | 192 | 21 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 475 | 228 | 329 | 20 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 302 | 112 | 189 | 20 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
