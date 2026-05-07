# MakaUg Performance Audit

Generated: 2026-05-07T06:02:13.611Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1472ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1472 | 1860 | 2605 | 19 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 770 | 773 | 3607 | 48 | 10 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 791 | 799 | 882 | 42 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 882 | 896 | 965 | 44 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 786 | 786 | 855 | 52 | 10 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 686 | 709 | 753 | 55 | 10 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 746 | 767 | 795 | 41 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 842 | 834 | 2238 | 51 | 10 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 724 | 733 | 789 | 27 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 645 | 647 | 675 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 690 | 682 | 707 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 634 | 638 | 660 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 860 | 866 | 889 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 1016 | 1007 | 1030 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 690 | 687 | 713 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 740 | 738 | 762 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 840 | 834 | 854 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 660 | 650 | 670 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 772 | 764 | 783 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 854 | 846 | 866 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 734 | 731 | 764 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 745 | 740 | 766 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 645 | 642 | 669 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 1045 | 1053 | 1084 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 712 | 705 | 732 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 692 | 685 | 713 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 700 | 695 | 721 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 728 | 721 | 762 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 708 | 693 | 732 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 632 | 610 | 634 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 679 | 676 | 704 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 657 | 650 | 703 | 29 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 622 | 614 | 641 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 743 | 736 | 761 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 655 | 648 | 670 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 993 | 988 | 1013 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 752 | 747 | 772 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 853 | 847 | 872 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 713 | 708 | 741 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 770 | 766 | 785 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 851 | 854 | 874 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 700 | 691 | 711 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 674 | 665 | 684 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 683 | 679 | 713 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 642 | 660 | 687 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 736 | 715 | 742 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
