# MakaUg Performance Audit

Generated: 2026-05-07T10:51:47.198Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1224ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1224 | 1559 | 2284 | 17 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 904 | 914 | 2242 | 35 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 636 | 658 | 692 | 42 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 717 | 713 | 818 | 43 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 767 | 781 | 925 | 43 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 692 | 705 | 748 | 47 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 971 | 979 | 1009 | 35 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 664 | 658 | 689 | 40 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 828 | 814 | 874 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 647 | 645 | 674 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 746 | 738 | 762 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 762 | 752 | 773 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 762 | 770 | 797 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 674 | 668 | 694 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 860 | 856 | 882 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 664 | 686 | 712 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 656 | 658 | 679 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 674 | 664 | 685 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 739 | 732 | 752 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 758 | 756 | 775 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 986 | 986 | 1022 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 1143 | 1136 | 1164 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 844 | 837 | 867 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 707 | 701 | 737 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 640 | 664 | 691 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 1053 | 1047 | 1074 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 725 | 719 | 746 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 974 | 972 | 1015 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 731 | 727 | 770 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 731 | 735 | 761 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 659 | 653 | 679 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 937 | 934 | 992 | 30 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 711 | 707 | 733 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 672 | 665 | 691 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 718 | 711 | 731 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 756 | 749 | 774 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 1093 | 1029 | 1066 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 855 | 854 | 882 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 742 | 740 | 764 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 743 | 733 | 753 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 755 | 747 | 767 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 715 | 707 | 726 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 664 | 656 | 676 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 688 | 682 | 714 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 1050 | 1045 | 1071 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 739 | 731 | 760 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
