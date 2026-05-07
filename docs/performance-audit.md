# MakaUg Performance Audit

Generated: 2026-05-07T13:14:36.478Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1366ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1366 | 1824 | 3346 | 18 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 907 | 923 | 5151 | 49 | 10 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 805 | 803 | 835 | 41 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 950 | 948 | 978 | 44 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 1051 | 1065 | 1133 | 44 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 1013 | 1017 | 1059 | 43 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 1142 | 1157 | 1186 | 40 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 712 | 706 | 736 | 38 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 802 | 792 | 852 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 701 | 692 | 720 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 653 | 625 | 649 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 670 | 668 | 689 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 841 | 831 | 857 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 726 | 717 | 743 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 975 | 973 | 998 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 1041 | 1036 | 1062 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 738 | 730 | 751 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 782 | 775 | 796 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 754 | 746 | 766 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 733 | 727 | 747 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 781 | 807 | 841 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 677 | 669 | 695 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 704 | 696 | 725 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 902 | 917 | 949 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 989 | 983 | 1010 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 689 | 685 | 715 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 984 | 988 | 1015 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 1093 | 1087 | 1130 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 661 | 657 | 698 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 956 | 952 | 978 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 691 | 684 | 713 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 945 | 940 | 996 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 724 | 719 | 746 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 660 | 654 | 679 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 834 | 826 | 849 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 755 | 751 | 777 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 847 | 840 | 865 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 1047 | 1042 | 1068 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 744 | 722 | 746 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 613 | 613 | 632 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 660 | 654 | 674 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 650 | 643 | 663 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 650 | 647 | 667 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 664 | 659 | 692 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 689 | 682 | 708 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 842 | 816 | 843 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
