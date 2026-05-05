# MakaUg Performance Audit

Generated: 2026-05-05T13:33:27.362Z

Base URL: https://makaug.com

Launch targets:
- Route body visible <= 1500ms on normal desktop connection.
- SPA/internal route body visible <= 500ms once JS is loaded.
- No console errors on public routes.
- Google Maps should not load on the homepage before active map use.
- Google Maps should not load on homepage, mortgage, advertise, or login routes before active map use.

Slowest route: `/report-fraud` (desktop) at 1030ms.

| Route | Viewport | Status | Body visible ms | DCL ms | Load ms | Resources | JS | CSS | Google Maps | Console errors | Result |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---|
| `/` | desktop | 200 | 981 | 1340 | 1372 | 17 | 1 | 1 | no | 0 | pass |
| `/to-rent` | desktop | 200 | 926 | 1418 | 1432 | 18 | 1 | 1 | yes | 0 | pass |
| `/for-sale` | desktop | 200 | 674 | 708 | 720 | 35 | 8 | 1 | yes | 0 | pass |
| `/land` | desktop | 200 | 718 | 728 | 740 | 34 | 8 | 1 | yes | 0 | pass |
| `/student-accommodation` | desktop | 200 | 895 | 927 | 973 | 39 | 8 | 1 | yes | 0 | pass |
| `/students` | desktop | 200 | 653 | 663 | 685 | 39 | 8 | 1 | yes | 0 | pass |
| `/commercial` | desktop | 200 | 754 | 772 | 784 | 33 | 8 | 1 | yes | 0 | pass |
| `/brokers` | desktop | 200 | 657 | 681 | 693 | 33 | 8 | 1 | yes | 0 | pass |
| `/list-property` | desktop | 200 | 682 | 707 | 738 | 28 | 7 | 1 | yes | 0 | pass |
| `/about` | desktop | 200 | 702 | 1223 | 1235 | 19 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | desktop | 200 | 679 | 683 | 692 | 19 | 1 | 1 | no | 0 | pass |
| `/careers` | desktop | 200 | 674 | 684 | 693 | 17 | 1 | 1 | no | 0 | pass |
| `/help` | desktop | 200 | 666 | 669 | 678 | 19 | 1 | 1 | no | 0 | pass |
| `/safety` | desktop | 200 | 868 | 870 | 879 | 19 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | desktop | 200 | 674 | 679 | 689 | 19 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | desktop | 200 | 1030 | 1429 | 1443 | 19 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | desktop | 200 | 775 | 773 | 780 | 17 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | desktop | 200 | 661 | 740 | 747 | 18 | 1 | 1 | no | 0 | pass |
| `/terms` | desktop | 200 | 957 | 1395 | 1403 | 18 | 1 | 1 | no | 0 | pass |
| `/advertise` | desktop | 200 | 777 | 780 | 788 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | desktop | 200 | 673 | 678 | 694 | 19 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | desktop | 200 | 838 | 839 | 850 | 19 | 1 | 1 | no | 0 | pass |
| `/login` | desktop | 200 | 674 | 683 | 693 | 18 | 1 | 1 | no | 0 | pass |
| `/` | mobile | 200 | 671 | 701 | 716 | 22 | 1 | 1 | no | 0 | pass |
| `/to-rent` | mobile | 200 | 1018 | 1461 | 1474 | 27 | 6 | 1 | yes | 0 | pass |
| `/for-sale` | mobile | 200 | 945 | 1431 | 1443 | 26 | 6 | 1 | yes | 0 | pass |
| `/land` | mobile | 200 | 663 | 662 | 672 | 26 | 6 | 1 | yes | 0 | pass |
| `/student-accommodation` | mobile | 200 | 715 | 724 | 748 | 29 | 6 | 1 | yes | 0 | pass |
| `/students` | mobile | 200 | 904 | 1407 | 1429 | 31 | 6 | 1 | yes | 0 | pass |
| `/commercial` | mobile | 200 | 664 | 663 | 673 | 26 | 6 | 1 | yes | 0 | pass |
| `/brokers` | mobile | 200 | 908 | 1394 | 1407 | 25 | 6 | 1 | yes | 0 | pass |
| `/list-property` | mobile | 200 | 918 | 1512 | 1541 | 27 | 7 | 1 | yes | 0 | pass |
| `/about` | mobile | 200 | 717 | 718 | 728 | 18 | 1 | 1 | no | 0 | pass |
| `/how-it-works` | mobile | 200 | 670 | 675 | 684 | 19 | 1 | 1 | no | 0 | pass |
| `/careers` | mobile | 200 | 713 | 713 | 721 | 18 | 1 | 1 | no | 0 | pass |
| `/help` | mobile | 200 | 696 | 721 | 732 | 18 | 1 | 1 | no | 0 | pass |
| `/safety` | mobile | 200 | 920 | 1434 | 1442 | 19 | 1 | 1 | no | 0 | pass |
| `/anti-fraud` | mobile | 200 | 940 | 1481 | 1491 | 19 | 1 | 1 | no | 0 | pass |
| `/report-fraud` | mobile | 200 | 730 | 736 | 745 | 19 | 1 | 1 | no | 0 | pass |
| `/privacy-policy` | mobile | 200 | 634 | 915 | 922 | 18 | 1 | 1 | no | 0 | pass |
| `/cookie-policy` | mobile | 200 | 933 | 1401 | 1409 | 18 | 1 | 1 | no | 0 | pass |
| `/terms` | mobile | 200 | 700 | 702 | 709 | 17 | 1 | 1 | no | 0 | pass |
| `/advertise` | mobile | 200 | 732 | 750 | 757 | 18 | 1 | 1 | no | 0 | pass |
| `/mortgage` | mobile | 200 | 690 | 695 | 709 | 18 | 1 | 1 | no | 0 | pass |
| `/discover-ai-chatbot` | mobile | 200 | 930 | 1404 | 1416 | 20 | 1 | 1 | no | 0 | pass |
| `/login` | mobile | 200 | 913 | 1413 | 1422 | 17 | 1 | 1 | no | 0 | pass |

Notes:
- These are lab probes from Playwright/Chrome against the configured base URL.
- Field Core Web Vitals are logged through `POST /api/analytics/web-vitals` where browser APIs support them.
