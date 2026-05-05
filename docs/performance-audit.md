# MakaUg Performance Audit

Generated: 2026-05-05T11:04:18.881Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/` (desktop) at 1219ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 1219 | 1565 | 2068 | 17 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 663 | 659 | 674 | 29 | 8 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 661 | 667 | 682 | 35 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 623 | 719 | 740 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 819 | 876 | 964 | 41 | 8 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 939 | 1434 | 1467 | 41 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 693 | 697 | 718 | 36 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 661 | 691 | 715 | 34 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 746 | 904 | 1045 | 28 | 7 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 712 | 704 | 724 | 19 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 678 | 678 | 692 | 19 | 1 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 633 | 639 | 649 | 18 | 1 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 919 | 1412 | 1425 | 19 | 1 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 893 | 1386 | 1397 | 19 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 616 | 643 | 659 | 19 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 696 | 685 | 707 | 19 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 652 | 667 | 681 | 17 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 679 | 649 | 662 | 18 | 1 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 724 | 756 | 769 | 18 | 1 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 637 | 691 | 700 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 674 | 785 | 817 | 19 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 863 | 870 | 883 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 658 | 652 | 667 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 653 | 689 | 716 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 653 | 686 | 704 | 27 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 644 | 647 | 661 | 27 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 646 | 651 | 664 | 25 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 652 | 683 | 708 | 31 | 6 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 883 | 1373 | 1400 | 31 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 655 | 689 | 710 | 22 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 646 | 664 | 689 | 26 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 638 | 687 | 729 | 30 | 7 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 692 | 679 | 696 | 19 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 629 | 642 | 659 | 19 | 1 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 872 | 1367 | 1375 | 18 | 1 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 684 | 668 | 679 | 19 | 1 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 680 | 690 | 699 | 19 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 740 | 749 | 761 | 19 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 648 | 637 | 647 | 19 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 647 | 629 | 636 | 18 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 617 | 617 | 625 | 18 | 1 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 668 | 651 | 658 | 18 | 1 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 725 | 720 | 727 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 645 | 676 | 693 | 19 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 726 | 734 | 746 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 648 | 632 | 643 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
