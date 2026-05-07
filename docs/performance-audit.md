# MakaUg Performance Audit

Generated: 2026-05-07T08:03:03.654Z

Base URL: http://127.0.0.1:5056

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 643ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 643 | 946 | 1652 | 20 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 169 | 66 | 851 | 34 | 3 | 2 | no | 0 | pass |
| `/for-sale` | desktop | 200 | 181 | 72 | 113 | 33 | 3 | 2 | no | 0 | pass |
| `/land` | desktop | 200 | 157 | 56 | 94 | 44 | 3 | 2 | no | 0 | pass |
| `/student-accommodation` | desktop | 200 | 211 | 57 | 138 | 36 | 3 | 2 | no | 0 | pass |
| `/students` | desktop | 200 | 175 | 56 | 103 | 36 | 3 | 2 | no | 0 | pass |
| `/commercial` | desktop | 200 | 162 | 59 | 89 | 32 | 3 | 2 | no | 0 | pass |
| `/brokers` | desktop | 200 | 149 | 57 | 120 | 29 | 3 | 2 | no | 0 | pass |
| `/list-property` | desktop | 200 | 204 | 96 | 180 | 31 | 3 | 2 | no | 0 | pass |
| `/about` | desktop | 200 | 145 | 53 | 82 | 21 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 146 | 57 | 80 | 19 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 147 | 51 | 74 | 20 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 146 | 51 | 78 | 21 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 148 | 53 | 80 | 21 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 151 | 57 | 87 | 21 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 149 | 59 | 91 | 21 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 132 | 54 | 75 | 20 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 132 | 57 | 77 | 18 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 136 | 50 | 71 | 20 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 139 | 57 | 78 | 20 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 177 | 67 | 105 | 20 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 157 | 54 | 88 | 22 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 144 | 56 | 86 | 20 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 150 | 53 | 90 | 23 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 158 | 56 | 85 | 28 | 3 | 2 | no | 0 | pass |
| `/for-sale` | mobile | 200 | 151 | 58 | 86 | 28 | 3 | 2 | no | 0 | pass |
| `/land` | mobile | 200 | 158 | 56 | 84 | 27 | 3 | 2 | no | 0 | pass |
| `/student-accommodation` | mobile | 200 | 167 | 55 | 100 | 32 | 3 | 2 | no | 0 | pass |
| `/students` | mobile | 200 | 166 | 55 | 97 | 32 | 3 | 2 | no | 0 | pass |
| `/commercial` | mobile | 200 | 158 | 56 | 84 | 28 | 3 | 2 | no | 0 | pass |
| `/brokers` | mobile | 200 | 158 | 57 | 85 | 26 | 3 | 2 | no | 0 | pass |
| `/list-property` | mobile | 200 | 169 | 61 | 134 | 32 | 3 | 2 | no | 0 | pass |
| `/about` | mobile | 200 | 155 | 54 | 82 | 21 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 151 | 57 | 80 | 19 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 143 | 52 | 76 | 20 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 138 | 57 | 84 | 21 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 139 | 56 | 83 | 21 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 139 | 59 | 85 | 21 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 132 | 57 | 83 | 21 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 141 | 50 | 71 | 20 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 159 | 51 | 71 | 20 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 131 | 53 | 74 | 20 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 127 | 53 | 73 | 20 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 160 | 56 | 91 | 21 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 149 | 53 | 81 | 22 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 146 | 51 | 80 | 20 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
