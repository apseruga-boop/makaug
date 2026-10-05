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
assert(app.includes('firstCategoryState.totalAuthoritative = firstCategoryExactTotal != null || !firstCategoryHasMore'), 'active category hydration should treat a terminal response as authoritative even without a total field');
assert(app.includes('firstPageState.totalAuthoritative = firstPageExactTotal != null || !firstPageHasMore'), 'initial category hydration should treat a terminal response as authoritative even without a total field');
assert(app.includes('publicCategoryStateHasAuthoritativeTotal(category, state)'), 'category total selection should prefer exact category totals over global opportunity stats');
assert(app.includes('function authoritativePublicCategoryPageRows'), 'renderAll should keep using exact active-route API rows after broader catalogue hydration');
assert(app.includes('if (key !== "students" && !publicCategoryActiveSearchPath(key)) return null'), 'authoritative cache guard must preserve student rows and active API-search rows without replacing normal category totals');
assert(app.includes('state.sourcePath !== activePath || state.mode !== "api"'), 'authoritative route rows must only apply to the matching active API source');
assert(app.includes('renderPublicCategoryPageWithAuthoritativeCache("students"'), 'student render path must use the authoritative active-route cache');
assert(app.includes('const authoritative = authoritativePublicCategoryPageRows(key);\n  const total = authoritative'), 'pagination controls must prefer authoritative route totals over stale passed totals');
assert(app.includes('const navHtml = unknownTotal ?'), 'unknown totals should render honest previous/next pagination without inventing a page count');
assert(app.includes('if (exactAuthoritative && requestedPage !== targetPage)'), 'pagination click handler must no-op when a stale click targets a non-existent exact page');

assert(app.includes('if (publicCategoryStateHasAuthoritativeTotal(category, state)) return stateTotal'), 'global summary counts must not overwrite exact category API totals');
assert(app.includes('const total = exactTotal ?? publicPaginationLoadedThrough(response, rows.length);\n  state.total = total;\n  state.totalAuthoritative = exactTotal != null || !hasMore'), 'exact zero totals should replace stale page totals while unknown totals retain an explicit lower bound');
assert(app.includes('const totalPages = Math.max(1, Math.ceil(total / pageSize))'), 'student range rendering should calculate a real page count');
assert(app.includes('const page = options.totalAuthoritative === true'), 'student header should clamp pages only when the API supplied an authoritative total');
assert(app.includes('const end = total ? Math.max(start, Math.min(total, rowEnd)) : 0'), 'student header range must never reverse start/end');
assert(app.includes('`of at least ${total}`'), 'student header must label non-authoritative totals as a lower bound');
assert(app.includes('options.totalAuthoritative === true && total === 0'), 'student empty copy must require an authoritative zero total');
assert(app.includes('options.loading || options.totalAuthoritative !== true'), 'student grid must retain a loading state while the result total is unknown');
assert(app.includes('el.setAttribute("aria-busy", options.loading ? "true" : "false")'), 'student result accessibility state must stop reporting busy after hydration');
assert(app.includes('const terminalApiResponse = Boolean(options.response) && state.hasMore === false'), 'a successful terminal API page must end the unknown-total loading state');
assert(app.includes('const hasServerRenderedRows = Boolean(grid?.querySelector("[data-ssr-property-card]"))'), 'startup rendering must detect server-rendered listing cards');
assert(app.includes('&& (state.loading === true || isExactNestedSeoRoute)'), 'exact nested SSR cards must survive both startup hydration and an API failure');
assert(app.includes('renderPublicCategoryPagination(key, { loading: state.loading === true })'), 'SSR preservation must not report perpetual loading after a failed refresh');
assert(/const refreshed = currentActiveCategory\s*\? await refreshActivePublicInventoryCategoryFromApi\(\{ silent \}\)/.test(app), 'delegated route refresh must expose whether the exact search failed');
assert(app.includes('return refreshed'), 'delegated route refresh must not report success after an exact search failure');
assert(!html.includes('Showing 0 properties • Prices per semester'), 'the static shell must not claim zero before live inventory loads');
assert(html.includes('Loading live student accommodation…'), 'the static shell must expose an honest loading state');
assert(html.includes('id="student-verified-f" value="0"'), 'student results must not silently default to a narrower verified-only filter');

assert(app.includes('if (normalized === "student") return "/api/properties?status=approved&public_only=1&student_portal=1"'), 'student page should keep using the student portal API');
assert(app.includes('category=${encodeURIComponent(normalized)}'), 'public category pages must use the category API contract that returns authoritative pagination totals');
assert(!app.includes('public_only=1&listing_type=${encodeURIComponent(normalized)}'), 'public category page loader must not use listing_type totals that collapse to the current page');
assert(app.includes('params.set("student_portal", "1")'), 'student searches should keep sending the student portal flag');
assert(app.includes('includeSummary: Boolean(activeRouteSearchPath) || activeCategory === "students"'), 'student first-page requests must ask for their own authoritative total');
assert(app.includes('const apiTotal = backendCategory === "student"'), 'the global explicit-student count must not overwrite the broader student-portal total');
assert(app.includes('`${hasMore ? "+" : ""} properties`') || app.includes('${hasMore ? "+" : ""} properties'), 'unknown totals should be labelled as a lower bound with a plus sign');
assert(app.includes('renderPublicCategoryPagination(startupCategory, { loading: true })'), 'category routes must immediately replace stale local pagination with a loading count while API totals hydrate');
assert(app.includes('loading ? "Loading listings..." : unknownTotal ? `Page ${page}`'), 'active category routes should distinguish loading from an unknown total');
assert(app.includes('navButton("Next ›", page + 1, loading || !hasMore)'), 'unknown-total routes should keep paging until the API reports no more rows');
assert(app.includes('const { rows: firstPageRows, firstResponse: firstPageResponse } = await firstPageRowsPromise'), 'first category page should render before waiting on the slower summary promise');
assert(app.indexOf('const { rows: firstPageRows, firstResponse: firstPageResponse } = await firstPageRowsPromise') < app.indexOf('const summaryStats = await summaryStatsPromise'), 'first page response must be applied before awaiting summary stats');

console.log('student page pagination/count regression checks passed');
