# MakaUg Performance Audit

Generated: 2026-05-17T02:34:43.849Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/brokers` (mobile) at 895ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 755 | 786 | 1299 | 16 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 798 | 763 | 1920 | 34 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 782 | 757 | 788 | 32 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 655 | 641 | 673 | 35 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 626 | 610 | 646 | 36 | 9 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 722 | 714 | 747 | 37 | 9 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 638 | 596 | 623 | 36 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 648 | 646 | 686 | 34 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 662 | 645 | 745 | 30 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 625 | 601 | 633 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 616 | 590 | 614 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 686 | 656 | 678 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 629 | 607 | 634 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 660 | 648 | 676 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 619 | 607 | 634 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 731 | 719 | 750 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 729 | 717 | 741 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 633 | 619 | 641 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 666 | 650 | 671 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 648 | 634 | 656 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 620 | 605 | 641 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 620 | 618 | 650 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 629 | 606 | 637 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 690 | 669 | 701 | 20 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 628 | 632 | 660 | 25 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 888 | 852 | 878 | 25 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 742 | 747 | 776 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 618 | 601 | 635 | 26 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 628 | 629 | 660 | 26 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 617 | 597 | 624 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 895 | 873 | 904 | 25 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 680 | 665 | 729 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 622 | 601 | 628 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 647 | 632 | 658 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 619 | 599 | 620 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 725 | 702 | 727 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 614 | 611 | 638 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 620 | 606 | 633 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 623 | 614 | 643 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 612 | 592 | 612 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 654 | 649 | 669 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 704 | 659 | 679 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 698 | 671 | 696 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 877 | 867 | 908 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 696 | 678 | 703 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 670 | 642 | 671 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
