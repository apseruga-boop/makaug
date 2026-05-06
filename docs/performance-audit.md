# MakaUg Performance Audit

Generated: 2026-05-06T09:58:20.105Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/mortgage` (mobile) at 1066ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 794 | 1298 | 3404 | 17 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 654 | 651 | 2014 | 35 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 939 | 950 | 1020 | 37 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 938 | 933 | 1002 | 36 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 937 | 948 | 1041 | 43 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 716 | 714 | 757 | 38 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 654 | 666 | 701 | 35 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 718 | 713 | 784 | 35 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 946 | 955 | 1026 | 30 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 907 | 928 | 956 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 912 | 924 | 949 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 753 | 744 | 766 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 938 | 919 | 948 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 740 | 752 | 779 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 629 | 640 | 669 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 703 | 716 | 742 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 619 | 627 | 647 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 665 | 662 | 683 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 623 | 617 | 636 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 623 | 602 | 624 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 936 | 967 | 1012 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 637 | 637 | 665 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 644 | 641 | 678 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1046 | 1008 | 1062 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 694 | 715 | 752 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 1042 | 1057 | 1088 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 646 | 642 | 669 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 659 | 648 | 689 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 900 | 914 | 954 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 654 | 642 | 669 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 695 | 682 | 709 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 899 | 916 | 985 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 649 | 659 | 687 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 644 | 667 | 693 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 685 | 677 | 701 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 959 | 962 | 991 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 592 | 654 | 682 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 910 | 944 | 972 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 688 | 686 | 712 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 680 | 695 | 716 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 658 | 638 | 658 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 648 | 644 | 663 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 679 | 669 | 692 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 1066 | 1095 | 1145 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 997 | 988 | 1012 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 650 | 641 | 668 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
