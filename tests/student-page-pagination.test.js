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
assert(html.includes('category-pagination-total-fix-20260715'), 'public shell must expose the cross-category pagination total fix marker');
assert(app.includes('CATEGORY_PAGINATION_TOTAL_FIX_MARKER = "category-pagination-total-fix-20260715"'), 'app bundle must carry the cross-category pagination total fix marker');
assert(html.includes('category-pagination-api-total-fix-20260715'), 'public shell must expose the category API total fix marker');
assert(app.includes('CATEGORY_PAGINATION_API_TOTAL_FIX_MARKER = "category-pagination-api-total-fix-20260715"'), 'app bundle must carry the category API total fix marker');
assert(html.includes('category-pagination-startup-loading-fix-20260715'), 'public shell must expose the category startup loading fix marker');
assert(app.includes('CATEGORY_PAGINATION_STARTUP_LOADING_FIX_MARKER = "category-pagination-startup-loading-fix-20260715"'), 'app bundle must carry the category startup loading fix marker');
assert(html.includes('category-pagination-loading-render-fix-20260715'), 'public shell must expose the category loading render fix marker');
assert(app.includes('CATEGORY_PAGINATION_LOADING_RENDER_FIX_MARKER = "category-pagination-loading-render-fix-20260715"'), 'app bundle must carry the category loading render fix marker');
assert(html.includes('category-pagination-no-local-total-fix-20260715'), 'public shell must expose the no-local-total category pagination fix marker');
assert(app.includes('CATEGORY_PAGINATION_NO_LOCAL_TOTAL_FIX_MARKER = "category-pagination-no-local-total-fix-20260715"'), 'app bundle must carry the no-local-total category pagination fix marker');

const scriptLoaderIndex = html.indexOf('script.src = "/assets/makaug-app.js?v="');
assert(scriptLoaderIndex > 0, 'public shell should load the app bundle with a versioned script URL');
assert(html.includes('script.src = "/assets/makaug-app.js?v=" + encodeURIComponent(window.__makaugAppVersion)'), 'the body script loader must use the shared commit-derived bundle version');
assert(html.includes('window.__makaugAppVersion = "__MAKAUG_BUNDLE_VERSION__"'), 'the public shell must expose the runtime commit placeholder');

assert(app.includes('function exactPublicPaginationTotalValue'), 'pagination should distinguish missing totals from exact zero totals');
assert(app.includes('response.pagination.total == null'), 'exact total helper must not treat a missing total as authoritative zero');
assert(app.includes('return Number.isFinite(total) && total >= 0 ? total : null'), 'exact total helper must preserve exact non-negative API totals');

assert(app.includes('totalAuthoritative: false'), 'category pagination state should track whether the total came from an exact API response');
assert(app.includes('state.totalAuthoritative = false'), 'changing source paths should clear stale authoritative totals');
assert(app.includes('firstCategoryState.totalAuthoritative = firstCategoryExactTotal != null'), 'active category hydration should mark exact API totals authoritative');
assert(app.includes('firstPageState.totalAuthoritative = exactPublicPaginationTotalValue(firstPageResponse) != null'), 'initial category hydration should mark exact API totals authoritative');
assert(app.includes('publicCategoryStateHasAuthoritativeTotal(category, state)'), 'category total selection should prefer exact category totals over global opportunity stats');
assert(app.includes('function authoritativePublicCategoryPageRows'), 'renderAll should keep using exact active-route API rows after broader catalogue hydration');
assert(app.includes('if (key !== "students" && !publicCategoryActiveSearchPath(key)) return null'), 'authoritative cache guard must preserve student rows and active API-search rows without replacing normal category totals');
assert(app.includes('state.sourcePath !== activePath || state.mode !== "api"'), 'authoritative route rows must only apply to the matching active API source');
assert(app.includes('renderPublicCategoryPageWithAuthoritativeCache("students"'), 'student render path must use the authoritative active-route cache');
assert(app.includes('const authoritative = authoritativePublicCategoryPageRows(key);\n  const total = authoritative'), 'pagination controls must prefer authoritative route totals over stale passed totals');
assert(app.includes('const navHtml = !awaitingExactRouteTotal && totalPages > 1'), 'single-page and pending-count result sets should not render clickable pagination navigation');
assert(app.includes('if (authoritative && requestedPage !== targetPage)'), 'pagination click handler must no-op when a stale click targets a non-existent authoritative page');

assert(app.includes('if (publicCategoryStateHasAuthoritativeTotal(category, state)) return stateTotal'), 'global summary counts must not overwrite exact category API totals');
assert(app.includes('state.total = total;\n  state.totalAuthoritative = exactPublicPaginationTotalValue(response) != null'), 'exact zero totals should replace stale page totals instead of falling through');
assert(app.includes('const totalPages = Math.max(1, Math.ceil(total / pageSize))'), 'student range rendering should clamp to real page count');
assert(app.includes('const page = Math.min(Math.max(1, Number(options.page) || 1), totalPages)'), 'student header page number should be clamped');
assert(app.includes('const end = total ? Math.max(start, Math.min(total, rowEnd)) : 0'), 'student header range must never reverse start/end');
assert(app.includes('const showing = total ? `Showing ${start}-${end} of ${total}` : "Showing 0"'), 'student header should use one honest total/range format');

assert(app.includes('if (normalized === "student") return "/api/properties?status=approved&public_only=1&student_portal=1"'), 'student page should keep using the student portal API');
assert(app.includes('category=${encodeURIComponent(normalized)}'), 'public category pages must use the category API contract that returns authoritative pagination totals');
assert(!app.includes('public_only=1&listing_type=${encodeURIComponent(normalized)}'), 'public category page loader must not use listing_type totals that collapse to the current page');
assert(app.includes('params.set("student_portal", "1")'), 'student searches should keep sending the student portal flag');
assert(app.includes('Fetching the full result count...'), 'startup pagination must not present a page-sized local count as the full result total');
assert(app.includes('renderPublicCategoryPagination(startupCategory, { loading: true })'), 'category routes must immediately replace stale local pagination with a loading count while API totals hydrate');
assert(app.includes('loading || awaitingExactRouteTotal ? "Loading listings..."'), 'active category routes must keep showing loading until an authoritative API total arrives');
assert(app.includes('!awaitingExactRouteTotal && totalPages > 1'), 'active category routes must not render local one-page navigation while exact totals are pending');
assert(app.includes('const { rows: firstPageRows, firstResponse: firstPageResponse } = await firstPageRowsPromise'), 'first category page should render before waiting on the slower summary promise');
assert(app.indexOf('const { rows: firstPageRows, firstResponse: firstPageResponse } = await firstPageRowsPromise') < app.indexOf('const summaryStats = await summaryStatsPromise'), 'first page response must be applied before awaiting summary stats');

console.log('student page pagination/count regression checks passed');
