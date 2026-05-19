# makaug Performance Audit

Generated: 2026-05-18T02:14:52.593Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/about` (mobile) at 1005ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 945 | 982 | 1563 | 17 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 620 | 615 | 1823 | 29 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 704 | 696 | 728 | 45 | 10 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 619 | 610 | 642 | 46 | 10 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 874 | 880 | 913 | 47 | 10 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 648 | 639 | 671 | 47 | 10 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 651 | 638 | 667 | 46 | 10 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 702 | 685 | 717 | 36 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 644 | 639 | 709 | 27 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 737 | 725 | 753 | 17 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 615 | 598 | 622 | 17 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 616 | 598 | 619 | 16 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 622 | 616 | 642 | 17 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 697 | 683 | 709 | 17 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 629 | 615 | 641 | 17 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 700 | 690 | 717 | 17 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 657 | 642 | 662 | 16 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 671 | 659 | 684 | 16 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 720 | 702 | 721 | 16 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 717 | 703 | 724 | 16 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 674 | 668 | 705 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 954 | 933 | 962 | 18 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 655 | 643 | 673 | 16 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 616 | 609 | 643 | 19 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 736 | 707 | 734 | 23 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 975 | 963 | 990 | 23 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 761 | 754 | 787 | 23 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 752 | 736 | 770 | 24 | 6 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 629 | 616 | 650 | 24 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 613 | 602 | 629 | 23 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 683 | 665 | 697 | 24 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 761 | 746 | 0 | 9 | 2 | 3 | no | 0 | pass |
| `/about` | mobile | 200 | 1005 | 660 | 712 | 15 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 739 | 731 | 761 | 17 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 759 | 716 | 736 | 16 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 763 | 752 | 777 | 17 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 765 | 755 | 782 | 17 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 658 | 652 | 682 | 17 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 616 | 610 | 634 | 17 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 972 | 958 | 977 | 16 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 619 | 599 | 618 | 16 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 760 | 745 | 766 | 16 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 673 | 660 | 680 | 16 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 676 | 670 | 710 | 17 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 644 | 630 | 656 | 18 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 758 | 741 | 770 | 16 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
