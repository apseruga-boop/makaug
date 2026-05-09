# MakaUg Performance Audit

Generated: 2026-05-09T07:20:44.431Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/list-property` (mobile) at 925ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 802 | 1438 | 3038 | 17 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 649 | 666 | 2229 | 34 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 623 | 628 | 665 | 38 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 640 | 642 | 696 | 42 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 691 | 665 | 764 | 42 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 634 | 644 | 698 | 46 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 620 | 623 | 660 | 40 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 647 | 648 | 693 | 41 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 649 | 660 | 727 | 30 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 674 | 655 | 683 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 649 | 646 | 670 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 624 | 623 | 644 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 884 | 883 | 909 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 878 | 889 | 917 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 626 | 643 | 670 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 632 | 638 | 662 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 639 | 653 | 672 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 637 | 636 | 659 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 638 | 631 | 650 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 809 | 808 | 831 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 865 | 871 | 910 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 652 | 640 | 668 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 605 | 607 | 641 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 924 | 948 | 1027 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 854 | 877 | 914 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 875 | 897 | 922 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 630 | 620 | 645 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 702 | 723 | 772 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 687 | 720 | 773 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 670 | 676 | 704 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 662 | 683 | 718 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 925 | 925 | 988 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 676 | 696 | 732 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 655 | 699 | 733 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 655 | 674 | 697 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 656 | 636 | 663 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 657 | 660 | 686 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 712 | 696 | 724 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 665 | 689 | 716 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 761 | 758 | 781 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 668 | 674 | 694 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 701 | 718 | 737 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 651 | 647 | 667 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 655 | 645 | 679 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 726 | 703 | 726 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 656 | 683 | 715 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
