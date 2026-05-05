# MakaUg Performance Audit

Generated: 2026-05-05T15:02:37.549Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1035ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1035 | 1426 | 2225 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 255 | 160 | 180 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 419 | 216 | 242 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 263 | 159 | 176 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 287 | 158 | 221 | 34 | 2 | 2 | no | 0 | pass |
| `/students` | desktop | 200 | 294 | 168 | 193 | 34 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 327 | 218 | 244 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 237 | 150 | 166 | 29 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 261 | 196 | 254 | 31 | 2 | 2 | no | 0 | pass |
| `/about` | desktop | 200 | 315 | 228 | 250 | 20 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 221 | 139 | 152 | 20 | 1 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 197 | 124 | 134 | 19 | 1 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 242 | 162 | 175 | 20 | 1 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 198 | 193 | 202 | 20 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 256 | 166 | 184 | 20 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 189 | 132 | 144 | 20 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 362 | 350 | 366 | 19 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 275 | 203 | 216 | 19 | 1 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 225 | 151 | 159 | 19 | 1 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 347 | 232 | 245 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 365 | 227 | 252 | 20 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 279 | 176 | 192 | 21 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 299 | 184 | 202 | 19 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 313 | 202 | 230 | 23 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 233 | 240 | 257 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 303 | 170 | 186 | 27 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 305 | 204 | 219 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 223 | 140 | 165 | 31 | 2 | 2 | no | 0 | pass |
| `/students` | mobile | 200 | 241 | 246 | 278 | 31 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 211 | 137 | 147 | 27 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 196 | 139 | 151 | 26 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 323 | 219 | 290 | 31 | 2 | 2 | no | 0 | pass |
| `/about` | mobile | 200 | 236 | 158 | 170 | 20 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 225 | 148 | 158 | 20 | 1 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 226 | 223 | 234 | 19 | 1 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 208 | 146 | 157 | 20 | 1 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 220 | 136 | 147 | 20 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 244 | 245 | 257 | 20 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 170 | 172 | 183 | 20 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 197 | 130 | 137 | 19 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 229 | 159 | 168 | 19 | 1 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 206 | 139 | 147 | 19 | 1 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 214 | 129 | 138 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 226 | 137 | 153 | 20 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 219 | 132 | 143 | 21 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 206 | 186 | 199 | 19 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
