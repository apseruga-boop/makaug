# MakaUg Performance Audit

Generated: 2026-05-07T12:28:31.635Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/discover-ai-chatbot` (desktop) at 1036ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 875 | 1482 | 2111 | 16 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 704 | 695 | 2245 | 35 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 630 | 631 | 661 | 42 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 686 | 688 | 718 | 43 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 734 | 735 | 806 | 40 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 910 | 920 | 963 | 40 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 640 | 656 | 686 | 40 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 664 | 638 | 668 | 34 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 664 | 674 | 742 | 31 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 647 | 646 | 674 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 686 | 706 | 730 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 681 | 670 | 694 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 1029 | 1033 | 1058 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 928 | 929 | 955 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 947 | 943 | 979 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 668 | 671 | 698 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 950 | 948 | 970 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 638 | 631 | 656 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 672 | 683 | 704 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 613 | 624 | 644 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 920 | 900 | 937 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 1036 | 1043 | 1070 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 798 | 811 | 841 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 665 | 676 | 712 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 692 | 668 | 694 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 648 | 633 | 660 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 645 | 650 | 678 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 697 | 712 | 763 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 689 | 672 | 714 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 911 | 893 | 919 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 652 | 645 | 671 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 766 | 774 | 832 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 701 | 721 | 749 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 766 | 766 | 790 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 635 | 633 | 657 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 645 | 656 | 681 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 939 | 941 | 967 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 938 | 952 | 977 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 635 | 627 | 650 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 647 | 640 | 660 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 721 | 708 | 728 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 664 | 657 | 676 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 641 | 621 | 641 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 938 | 953 | 990 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 646 | 622 | 650 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 657 | 636 | 664 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
