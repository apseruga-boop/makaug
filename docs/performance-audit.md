# MakaUg Performance Audit

Generated: 2026-05-07T19:16:28.802Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1096ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1096 | 1482 | 2325 | 18 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 774 | 779 | 2121 | 34 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 960 | 958 | 996 | 34 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 732 | 728 | 760 | 35 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 916 | 924 | 996 | 40 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 1032 | 1036 | 1077 | 40 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 835 | 847 | 875 | 32 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 741 | 734 | 770 | 34 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 1063 | 1056 | 1164 | 31 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 936 | 929 | 956 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 661 | 656 | 681 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 754 | 747 | 769 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 994 | 987 | 1012 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 815 | 809 | 835 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 642 | 640 | 664 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 1032 | 1028 | 1052 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 961 | 954 | 974 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 606 | 628 | 650 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 752 | 745 | 766 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 719 | 711 | 732 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 756 | 759 | 794 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 1039 | 1024 | 1050 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 759 | 751 | 780 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 816 | 825 | 858 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 1037 | 1033 | 1060 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 745 | 742 | 770 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 728 | 722 | 748 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 736 | 732 | 774 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 1059 | 1057 | 1096 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 836 | 833 | 859 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 706 | 681 | 708 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 706 | 700 | 754 | 29 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 747 | 745 | 771 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 653 | 648 | 673 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 675 | 668 | 689 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 755 | 748 | 773 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 646 | 641 | 666 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 1083 | 1080 | 1105 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 845 | 845 | 872 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 709 | 700 | 719 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 649 | 646 | 666 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 692 | 682 | 701 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 643 | 637 | 656 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 764 | 761 | 794 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 1019 | 1013 | 1038 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 623 | 624 | 652 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
