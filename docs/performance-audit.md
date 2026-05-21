# makaug Performance Audit

Generated: 2026-05-21T04:46:00.713Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/mortgage` (mobile) at 969ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 745 | 795 | 2905 | 20 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 658 | 656 | 1775 | 30 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 631 | 638 | 670 | 48 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 634 | 625 | 655 | 45 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 631 | 623 | 660 | 34 | 8 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 622 | 618 | 654 | 46 | 10 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 878 | 868 | 898 | 47 | 10 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 733 | 722 | 763 | 40 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 674 | 671 | 746 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 637 | 624 | 660 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 667 | 645 | 672 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 684 | 670 | 694 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 662 | 656 | 686 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 773 | 762 | 789 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 712 | 723 | 753 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 658 | 654 | 687 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 650 | 647 | 675 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 626 | 615 | 639 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 696 | 699 | 724 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 734 | 721 | 745 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 633 | 632 | 678 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 743 | 727 | 759 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 658 | 632 | 666 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 959 | 936 | 972 | 23 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 743 | 735 | 764 | 24 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 736 | 736 | 772 | 39 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 641 | 626 | 659 | 26 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 671 | 664 | 698 | 25 | 6 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 646 | 639 | 675 | 25 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 716 | 701 | 732 | 24 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 757 | 748 | 782 | 31 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 659 | 0 | 0 | 0 | 0 | 0 | no | 0 | pass |
| `/about` | mobile | 200 | 640 | 742 | 808 | 14 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 625 | 627 | 663 | 17 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 862 | 851 | 875 | 16 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 667 | 658 | 688 | 17 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 640 | 626 | 655 | 17 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 645 | 648 | 681 | 17 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 677 | 673 | 702 | 17 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 743 | 739 | 761 | 16 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 650 | 638 | 659 | 16 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 687 | 661 | 686 | 16 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 720 | 704 | 730 | 16 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 969 | 957 | 995 | 17 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 673 | 652 | 682 | 18 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 723 | 691 | 729 | 16 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
