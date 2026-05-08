# MakaUg Performance Audit

Generated: 2026-05-08T02:01:51.806Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/safety` (desktop) at 930ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 689 | 750 | 1199 | 19 | 2 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 622 | 614 | 1879 | 35 | 9 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 639 | 616 | 712 | 42 | 9 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 628 | 615 | 649 | 44 | 9 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 617 | 632 | 710 | 53 | 10 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 772 | 793 | 837 | 54 | 10 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 614 | 615 | 649 | 41 | 9 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 625 | 640 | 673 | 41 | 9 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 899 | 884 | 951 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 623 | 613 | 644 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 603 | 610 | 641 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 614 | 604 | 626 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 684 | 667 | 693 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 930 | 943 | 976 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 647 | 643 | 675 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 613 | 637 | 664 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 611 | 615 | 637 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 668 | 665 | 687 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 630 | 613 | 634 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 714 | 705 | 725 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 607 | 608 | 651 | 19 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 639 | 637 | 663 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 742 | 748 | 778 | 17 | 2 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 676 | 691 | 724 | 22 | 2 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 900 | 877 | 905 | 26 | 7 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 631 | 620 | 647 | 26 | 7 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 720 | 706 | 734 | 25 | 7 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 666 | 684 | 733 | 30 | 7 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 620 | 638 | 679 | 30 | 7 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 598 | 604 | 628 | 25 | 7 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 626 | 618 | 650 | 26 | 7 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 638 | 619 | 674 | 28 | 8 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 638 | 618 | 646 | 18 | 2 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 701 | 709 | 736 | 18 | 2 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 602 | 618 | 639 | 17 | 2 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 871 | 894 | 919 | 18 | 2 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 691 | 684 | 709 | 18 | 2 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 653 | 655 | 681 | 18 | 2 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 706 | 705 | 729 | 18 | 2 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 636 | 630 | 651 | 17 | 2 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 681 | 674 | 694 | 17 | 2 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 648 | 641 | 661 | 17 | 2 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 757 | 748 | 769 | 17 | 2 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 761 | 758 | 792 | 18 | 2 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 737 | 730 | 755 | 19 | 2 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 740 | 735 | 763 | 17 | 2 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
