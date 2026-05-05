# MakaUg Performance Audit

Generated: 2026-05-05T16:42:20.637Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 628ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 628 | 1001 | 1737 | 20 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 195 | 100 | 114 | 33 | 2 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 208 | 100 | 129 | 32 | 2 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 179 | 95 | 117 | 43 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 234 | 109 | 160 | 34 | 2 | 2 | no | 0 | pass |
| `/students` | desktop | 200 | 219 | 135 | 162 | 34 | 2 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 222 | 103 | 121 | 31 | 2 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 222 | 123 | 141 | 29 | 2 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 240 | 148 | 215 | 31 | 2 | 2 | no | 0 | pass |
| `/about` | desktop | 200 | 184 | 122 | 135 | 20 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 143 | 86 | 97 | 20 | 1 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 155 | 84 | 96 | 19 | 1 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 158 | 83 | 94 | 20 | 1 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 193 | 112 | 131 | 20 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 178 | 102 | 117 | 20 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 178 | 102 | 114 | 20 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 160 | 78 | 87 | 19 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 149 | 88 | 97 | 19 | 1 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 167 | 95 | 104 | 19 | 1 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 162 | 90 | 99 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 173 | 98 | 115 | 20 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 230 | 138 | 155 | 21 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 166 | 89 | 100 | 19 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 194 | 113 | 131 | 23 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 145 | 84 | 96 | 27 | 2 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 151 | 87 | 99 | 27 | 2 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 173 | 104 | 116 | 26 | 2 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 184 | 103 | 128 | 31 | 2 | 2 | no | 0 | pass |
| `/students` | mobile | 200 | 185 | 101 | 125 | 31 | 2 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 155 | 86 | 97 | 27 | 2 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 151 | 83 | 96 | 26 | 2 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 218 | 126 | 177 | 31 | 2 | 2 | no | 0 | pass |
| `/about` | mobile | 200 | 182 | 96 | 108 | 20 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 155 | 96 | 107 | 20 | 1 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 229 | 135 | 146 | 19 | 1 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 155 | 83 | 97 | 20 | 1 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 228 | 129 | 143 | 20 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 245 | 141 | 156 | 20 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 227 | 146 | 162 | 20 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 157 | 97 | 106 | 19 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 191 | 110 | 121 | 19 | 1 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 143 | 82 | 90 | 19 | 1 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 163 | 81 | 91 | 19 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 183 | 110 | 127 | 20 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 196 | 89 | 99 | 21 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 184 | 110 | 122 | 19 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
