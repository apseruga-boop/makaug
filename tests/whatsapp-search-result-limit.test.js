const assert = require('assert');
const fs = require('fs');
const path = require('path');

const whatsappRouteSource = fs.readFileSync(path.join(__dirname, '..', 'routes', 'whatsapp.js'), 'utf8');

assert(whatsappRouteSource.includes('const WHATSAPP_PROPERTY_RESULT_LIMIT = 10'), 'WhatsApp property search should cap customer replies at 10 listings');
assert(whatsappRouteSource.includes('ORDER BY p.created_at DESC'), 'WhatsApp property searches should order listings by newest listed date first');
assert(whatsappRouteSource.includes('COUNT(*) OVER() AS total_count'), 'WhatsApp property searches should know when more matches exist');
assert(whatsappRouteSource.includes('LIMIT $'), 'WhatsApp property searches should bind the result limit instead of hard-coding five rows');
assert(whatsappRouteSource.includes('አዲሶቹን {shown} አሳይቻለሁ'), 'Amharic WhatsApp result cards should include translated more-results copy');
assert(whatsappRouteSource.includes('const visibleRows = Array.isArray(rows) ? rows.slice(0, WHATSAPP_PROPERTY_RESULT_LIMIT) : []'), 'Formatter should slice visible WhatsApp search rows to the shared cap');
assert(whatsappRouteSource.includes('totalMatches > visibleRows.length'), 'Formatter should show a website link when more matches exist');
assert(whatsappRouteSource.includes('whatsappSearchResultsUrl(searchType, location)'), 'More-results message should link to filtered website results');
assert(whatsappRouteSource.includes('`${HOME_URL}/#page-sale${query ? `?${query}` : \'\'}'), 'More-results URLs should open the public listings page');
assert(whatsappRouteSource.includes('am: {') && whatsappRouteSource.includes("filter: 'ማጣሪያ'"), 'Formatter should have Amharic result-card copy instead of English-only copy');

console.log('WhatsApp search result limit tests passed');
