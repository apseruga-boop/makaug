'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(html.includes('student-page-pagination-fix-20260715'), 'public shell must expose the student pagination fix marker');
assert(app.includes('STUDENT_PAGE_PAGINATION_FIX_MARKER = "student-page-pagination-fix-20260715"'), 'app bundle must carry the student pagination fix marker');

assert(app.includes('function exactPublicPaginationTotalValue'), 'pagination should distinguish missing totals from exact zero totals');
assert(app.includes('response.pagination.total == null'), 'exact total helper must not treat a missing total as authoritative zero');
assert(app.includes('return Number.isFinite(total) && total >= 0 ? total : null'), 'exact total helper must preserve exact non-negative API totals');

assert(app.includes('totalAuthoritative: false'), 'category pagination state should track whether the total came from an exact API response');
assert(app.includes('state.totalAuthoritative = false'), 'changing source paths should clear stale authoritative totals');
assert(app.includes('firstCategoryState.totalAuthoritative = firstCategoryExactTotal != null'), 'active category hydration should mark exact API totals authoritative');
assert(app.includes('firstPageState.totalAuthoritative = exactPublicPaginationTotalValue(firstPageResponse) != null'), 'initial category hydration should mark exact API totals authoritative');
assert(app.includes('publicCategoryStateHasAuthoritativeTotal(category, state)'), 'category total selection should prefer exact category totals over global opportunity stats');

assert(app.includes('if (publicCategoryStateHasAuthoritativeTotal(category, state)) return stateTotal'), 'global summary counts must not overwrite exact category API totals');
assert(app.includes('state.total = total;\n  state.totalAuthoritative = exactPublicPaginationTotalValue(response) != null'), 'exact zero totals should replace stale page totals instead of falling through');
assert(app.includes('const totalPages = Math.max(1, Math.ceil(total / pageSize))'), 'student range rendering should clamp to real page count');
assert(app.includes('const page = Math.min(Math.max(1, Number(options.page) || 1), totalPages)'), 'student header page number should be clamped');
assert(app.includes('const end = total ? Math.max(start, Math.min(total, rowEnd)) : 0'), 'student header range must never reverse start/end');
assert(app.includes('const showing = total ? `Showing ${start}-${end} of ${total}` : "Showing 0"'), 'student header should use one honest total/range format');

assert(app.includes('if (normalized === "student") return "/api/properties?status=approved&public_only=1&student_portal=1"'), 'student page should keep using the student portal API');
assert(app.includes('params.set("student_portal", "1")'), 'student searches should keep sending the student portal flag');

console.log('student page pagination/count regression checks passed');
