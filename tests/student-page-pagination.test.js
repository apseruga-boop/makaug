'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

assert(html.includes('student-page-pagination-fix-20260715'), 'public shell must expose the student pagination fix marker');
assert(app.includes('STUDENT_PAGE_PAGINATION_FIX_MARKER = "student-page-pagination-fix-20260715"'), 'app bundle must carry the student pagination fix marker');
assert(html.includes('student-pagination-nav-fix-20260715'), 'public shell must expose the student pagination navigation fix marker');
assert(app.includes('STUDENT_PAGINATION_NAV_FIX_MARKER = "student-pagination-nav-fix-20260715"'), 'app bundle must carry the student pagination navigation fix marker');

const scriptLoaderIndex = html.indexOf('script.src = "/assets/makaug-app.js?v="');
assert(scriptLoaderIndex > 0, 'public shell should load the app bundle with a versioned script URL');
const scriptLoaderVersionBlock = html.slice(Math.max(0, scriptLoaderIndex - 1200), scriptLoaderIndex);
assert(scriptLoaderVersionBlock.includes('student-page-pagination-fix-20260715'), 'the body script loader must include the student pagination marker so stale bundles are busted');
assert(scriptLoaderVersionBlock.includes('student-pagination-nav-fix-20260715'), 'the body script loader must include the student nav marker so stale click handlers are busted');

assert(app.includes('function exactPublicPaginationTotalValue'), 'pagination should distinguish missing totals from exact zero totals');
assert(app.includes('response.pagination.total == null'), 'exact total helper must not treat a missing total as authoritative zero');
assert(app.includes('return Number.isFinite(total) && total >= 0 ? total : null'), 'exact total helper must preserve exact non-negative API totals');

assert(app.includes('totalAuthoritative: false'), 'category pagination state should track whether the total came from an exact API response');
assert(app.includes('state.totalAuthoritative = false'), 'changing source paths should clear stale authoritative totals');
assert(app.includes('firstCategoryState.totalAuthoritative = firstCategoryExactTotal != null'), 'active category hydration should mark exact API totals authoritative');
assert(app.includes('firstPageState.totalAuthoritative = exactPublicPaginationTotalValue(firstPageResponse) != null'), 'initial category hydration should mark exact API totals authoritative');
assert(app.includes('publicCategoryStateHasAuthoritativeTotal(category, state)'), 'category total selection should prefer exact category totals over global opportunity stats');
assert(app.includes('function authoritativePublicCategoryPageRows'), 'renderAll should keep using exact active-route API rows after broader catalogue hydration');
assert(app.includes('state.sourcePath !== activePath || state.mode !== "api"'), 'authoritative route rows must only apply to the matching active API source');
assert(app.includes('renderPublicCategoryPageWithAuthoritativeCache("students"'), 'student render path must use the authoritative active-route cache');
assert(app.includes('const authoritative = authoritativePublicCategoryPageRows(key);\n  const total = authoritative'), 'pagination controls must prefer authoritative route totals over stale passed totals');
assert(app.includes('const navHtml = totalPages > 1'), 'single-page result sets should not render clickable pagination navigation');
assert(app.includes('if (authoritative && requestedPage !== targetPage)'), 'pagination click handler must no-op when a stale click targets a non-existent authoritative page');

assert(app.includes('if (publicCategoryStateHasAuthoritativeTotal(category, state)) return stateTotal'), 'global summary counts must not overwrite exact category API totals');
assert(app.includes('state.total = total;\n  state.totalAuthoritative = exactPublicPaginationTotalValue(response) != null'), 'exact zero totals should replace stale page totals instead of falling through');
assert(app.includes('const totalPages = Math.max(1, Math.ceil(total / pageSize))'), 'student range rendering should clamp to real page count');
assert(app.includes('const page = Math.min(Math.max(1, Number(options.page) || 1), totalPages)'), 'student header page number should be clamped');
assert(app.includes('const end = total ? Math.max(start, Math.min(total, rowEnd)) : 0'), 'student header range must never reverse start/end');
assert(app.includes('const showing = total ? `Showing ${start}-${end} of ${total}` : "Showing 0"'), 'student header should use one honest total/range format');

assert(app.includes('if (normalized === "student") return "/api/properties?status=approved&public_only=1&student_portal=1"'), 'student page should keep using the student portal API');
assert(app.includes('params.set("student_portal", "1")'), 'student searches should keep sending the student portal flag');

console.log('student page pagination/count regression checks passed');
