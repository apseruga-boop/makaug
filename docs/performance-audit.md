# makaug Performance Audit

Generated: 2026-05-19T09:21:34.735Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1012ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1012 | 1386 | 1971 | 17 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 687 | 675 | 746 | 19 | 2 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 715 | 722 | 807 | 30 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 801 | 726 | 785 | 31 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 832 | 813 | 871 | 34 | 8 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 691 | 665 | 716 | 35 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 678 | 652 | 702 | 34 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 700 | 669 | 728 | 38 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 762 | 751 | 899 | 30 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 695 | 659 | 713 | 17 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 713 | 671 | 712 | 17 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 732 | 705 | 742 | 16 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 682 | 654 | 698 | 17 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 737 | 717 | 767 | 17 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 728 | 706 | 758 | 17 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 916 | 987 | 1081 | 17 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 755 | 670 | 712 | 16 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 723 | 678 | 704 | 16 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 758 | 725 | 752 | 16 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 644 | 632 | 657 | 16 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 766 | 736 | 784 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 914 | 900 | 935 | 18 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 647 | 626 | 659 | 16 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 753 | 738 | 782 | 20 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 734 | 704 | 734 | 23 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 737 | 749 | 799 | 22 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 702 | 684 | 717 | 23 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 772 | 758 | 800 | 24 | 6 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 671 | 632 | 667 | 24 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 685 | 667 | 699 | 23 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 649 | 619 | 656 | 25 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 698 | 0 | 0 | 0 | 0 | 0 | no | 0 | pass |
| `/about` | mobile | 200 | 591 | 726 | 812 | 15 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 665 | 666 | 716 | 17 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 941 | 927 | 948 | 16 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 745 | 725 | 766 | 17 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 648 | 644 | 673 | 17 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 653 | 646 | 674 | 17 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 662 | 652 | 682 | 17 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 944 | 924 | 947 | 16 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 727 | 720 | 741 | 16 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 644 | 627 | 651 | 16 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 917 | 898 | 920 | 16 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 911 | 920 | 981 | 17 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 730 | 716 | 748 | 18 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 680 | 652 | 692 | 16 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
