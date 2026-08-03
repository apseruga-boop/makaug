'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const {
  inferNearestUniversityFromListing,
  normalizeUniversityName
} = require('../utils/universityMatcher');

const frontend = read('assets/makaug-app.js');
const propertiesRoute = read('routes/properties.js');
const whatsappRoute = read('routes/whatsapp.js');
const socialSearchService = read('services/socialSearchSourcedListingsService.js');
const sourceContentQuality = read('utils/sourceContentQuality.js');

assert.strictEqual(normalizeUniversityName('Makerere'), 'Makerere University');
assert.strictEqual(normalizeUniversityName('UCU'), 'Uganda Christian University (UCU)');
assert.strictEqual(
  inferNearestUniversityFromListing({
    title: 'Student accommodation in Bishop Tucker Road, Mukono Town',
    description: 'Affordable rooms near campus',
    area: 'Mukono Town',
    district: 'Mukono'
  }),
  'Uganda Christian University (UCU)'
);

assert(frontend.includes('function inferStudentNearestUniversity'), 'student cards should infer a nearest university in the browser');
assert(frontend.includes('function studentCardFooterText'), 'student cards should feed the nearest university into the shared card footer');
assert(frontend.includes('return nearestUniversity || (!/near\\s+campus/i.test(walkText) ? walkText : "")'), 'student cards should render the university name before generic walk text');
assert(!frontend.includes('const bottomText = p.student_walk_text || "Near campus";'), 'student cards must not fall back to generic Near campus copy');

assert(propertiesRoute.includes('function studentUniversityContextFor'), 'public property API should build student university context');
assert(propertiesRoute.includes('p.nearest_university,'), 'public property queries should select nearest_university');
assert(propertiesRoute.includes('nearest_university: studentContext.nearest_university || null'), 'public property rows should expose inferred nearest_university');

assert(whatsappRoute.includes('function studentUniversityLineForWhatsapp'), 'WhatsApp cards should format the nearest university');
assert(whatsappRoute.includes('p.nearest_university, p.distance_to_uni_km, p.room_type, p.room_arrangement, p.students_welcome, p.extra_fields'), 'WhatsApp queries should select student metadata');
assert(whatsappRoute.includes('🎓 ${studentUniversityLine}'), 'WhatsApp result cards should include the university line');

assert(socialSearchService.includes('function nearestUniversityForSourceItem'), 'found-online ingestion should infer the nearest university');
assert(socialSearchService.includes('nearest_university: nearestUniversity || null'), 'found-online listings should persist nearest_university');
assert(socialSearchService.includes('student_universities: nearestUniversity ? normalizeUniversityList([nearestUniversity]) : []'), 'found-online listings should persist student_universities');
assert(sourceContentQuality.includes('self[-\\s]*contained'), 'shared found-online quality rules should recognize self-contained student room vocabulary');
assert(socialSearchService.includes('STUDENT_NEAR_CAMPUS_RADIUS_KM = 2'), 'found-online ingestion should apply the 2km near-campus student supply rule');
assert(socialSearchService.includes("const listingType = studentListing ? 'students' : originalListingType"), 'found-online ingestion should route student supply to the student category');

console.log('Student nearest-university tests passed');
