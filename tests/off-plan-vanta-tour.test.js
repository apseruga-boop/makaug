'use strict';

/**
 * The 3D tour of the Vanta House homes (20 Nov 2026): one page,
 * /off-plan/vanta-house/tour, built from the developer's typical floor plan.
 *
 * The page carries its own floor plans as data, so the checks below run that
 * data the same way the page does: every room is where the plan puts it, the
 * guided tour reaches every room without walking through a wall, and what the
 * welcome screen says matches the listing.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const tourFile = path.join(root, 'assets', 'off-plan', 'vanta-house', 'tour.html');
const html = fs.readFileSync(tourFile, 'utf8');
const vanta = JSON.parse(fs.readFileSync(path.join(root, 'data', 'off-plan', 'vanta-house.development.json'), 'utf8'));
const server = fs.readFileSync(path.join(root, 'server.js'), 'utf8');
const client = fs.readFileSync(path.join(root, 'assets', 'off-plan.js'), 'utf8');
const app = fs.readFileSync(path.join(root, 'assets', 'makaug-app.js'), 'utf8');

// The page's own scripts, in order. The first four (the homes, the plan
// reader, the tour route and the words) need no browser.
const inline = [...html.matchAll(/<script>\n([\s\S]*?)\n<\/script>/g)].map((match) => match[1]);
const sandbox = { console };
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
inline.slice(0, 4).forEach((source, index) => vm.runInContext(source, sandbox, { filename: `tour-script-${index + 1}.js` }));
const DATA = sandbox.VANTA_TOUR_DATA;
const PLAN = sandbox.VANTA_TOUR_PLAN;
const GUIDE = sandbox.VANTA_TOUR_GUIDE;
const TEXT = sandbox.VANTA_TOUR_TEXT;
const PX = DATA.PX_PER_M;
const plans = Object.fromEntries(DATA.order.map((key) => [key, PLAN.buildPlan(DATA.homes[key], PX)]));

test('the tour page is one self-contained file served at its own address', () => {
  assert.equal(inline.length, 9, 'nine parts: homes, plan, route, words, materials, walls, furniture, sky, app');
  const sources = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map((match) => match[1]);
  assert.deepStrictEqual(sources, ['/assets/vendor/three.min.js?v=r160'], 'the only outside script is makaug\'s own copy of three.js');
  assert.ok(fs.existsSync(path.join(root, 'assets', 'vendor', 'three.min.js')));
  const outside = [...html.matchAll(/https?:\/\/[^"'\s)<]+/g)].map((match) => match[0]).filter((url) => !/^https:\/\/makaug\.com\//.test(url));
  assert.deepStrictEqual(outside, [], 'nothing is loaded from, or linked to, another site');
  assert.doesNotMatch(html, /<link[^>]+rel="stylesheet"/, 'no outside stylesheet');
  assert.doesNotMatch(html, /<audio|\.mp3|\.ogg|\.wav"/, 'the music is made in the page, not loaded from a sound file');
  assert.ok(html.length < 400 * 1024, 'the page stays small enough for a phone connection');

  const route = server.indexOf("app.get('/off-plan/:slug/tour'");
  assert.ok(route > 0, 'the tour route exists');
  assert.ok(route < server.indexOf("app.get('/off-plan/:slug',"), 'before the project page route');
  assert.ok(route < server.indexOf("app.get('*'"), 'before the public shell catch-all');
  const handler = server.slice(route, server.indexOf('});', server.indexOf('fs.access(file', route)) + 3);
  assert.match(handler, /\/\^\[a-z0-9\]\[a-z0-9-\]\{0,80\}\$\/\.test\(slug\)/, 'only a plain slug can name the folder');
  assert.match(handler, /path\.join\(staticRoot, 'assets', 'off-plan', slug, 'tour\.html'\)/);
  assert.match(handler, /if \(error\) return next\(\);/, 'a project without a tour falls through to the normal pages');
});

test('no private contact details are written into the tour page', () => {
  assert.doesNotMatch(html, /(?:\+?256|\b0)7\d{8}\b/, 'no phone number');
  assert.doesNotMatch(html, /wa\.me\//, 'no WhatsApp link of its own: the enquiry answer supplies it');
  assert.doesNotMatch(html, /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/, 'no email address');
  const appPart = inline[8];
  assert.match(appPart, /fetch\('\/api\/off-plan\/' \+ encodeURIComponent\(project\.slug\)/, 'the listing is read live for name, prices and who it is listed by');
  assert.match(appPart, /'\/api\/off-plan\/enquiries'/, 'the contact form goes to the makaug enquiry desk');
  assert.match(appPart, /from: '3d_tour'/, 'so staff can see the enquiry came from the tour');
});

test('each home matches the developer\'s plan: size, rooms, doors and furniture', () => {
  assert.deepStrictEqual(Array.from(DATA.order), ['1bhk', '2bhk', '3bhk']);
  for (const key of DATA.order) {
    const home = DATA.homes[key];
    const plan = plans[key];
    const unit = vanta.unit_types.find((item) => item.key === key);
    assert.ok(unit, `${key} is a home type on the listing`);
    assert.deepStrictEqual(Array.from(plan.problems), [], `${key}: every door and window sits in a wall`);

    // Size: the rooms as drawn, wall to wall, against the developer's figure.
    assert.equal(home.sizeSqm, unit.size_sqm, `${key}: the size shown is the listing's`);
    const drift = Math.abs(plan.grossM2 - unit.size_sqm) / unit.size_sqm;
    assert.ok(drift < 0.03, `${key}: drawn ${plan.grossM2.toFixed(1)} m² against the developer's ${unit.size_sqm} m²`);

    // Rooms: as many bedrooms and bathrooms as the listing says.
    assert.equal(home.rooms.filter((room) => room.kind === 'bed').length, unit.bedrooms, `${key}: bedrooms`);
    assert.equal(home.rooms.filter((room) => room.kind === 'bath').length, unit.bathrooms, `${key}: bathrooms`);
    assert.equal(home.beds, unit.bedrooms);
    assert.equal(home.baths, unit.bathrooms);
    assert.ok(home.rooms.some((room) => room.kind === 'balcony'), `${key}: has a balcony`);

    // Doors join two rooms (the front door joins the home to the corridor), and every room can be walked to.
    const doors = plan.openings.filter((opening) => opening.k === 'door' || opening.k === 'slider');
    for (const door of doors) {
      const joined = door.rooms.filter(Boolean).length;
      assert.ok(door.type === 'entry' ? joined === 1 : joined === 2, `${key}: a ${door.k} at ${door.c},${door.a} joins ${door.rooms.join(' and ')}`);
    }
    assert.equal(plan.openings.filter((opening) => opening.type === 'entry').length, 1, `${key}: one front door`);
    assert.deepStrictEqual(Array.from(PLAN.unreachableRooms(plan)), [], `${key}: no room is cut off`);

    // Furniture stands on the floor of one room, never across a wall.
    home.items.forEach((item, index) => {
      for (const rect of PLAN.footprints(item)) {
        const corners = [[rect[0] + 0.5, rect[1] + 0.5], [rect[2] - 0.5, rect[1] + 0.5], [rect[0] + 0.5, rect[3] - 0.5], [rect[2] - 0.5, rect[3] - 0.5]];
        const rooms = new Set(corners.map((corner) => plan.roomAt(corner[0], corner[1])));
        assert.ok(!rooms.has(null) && rooms.size === 1, `${key}: item ${index} (${item.t}) stands inside one room`);
      }
    });
    assert.ok(home.items.filter((item) => item.t === 'bed').length === unit.bedrooms, `${key}: a bed in every bedroom`);
  }
  assert.equal(DATA.WALL_HEIGHT, 2.85, 'the drawing gives no ceiling height; 2.85 m is the stated assumption');
});

test('the guided tour starts at the front door, shows every room, and never walks through anything', () => {
  for (const key of DATA.order) {
    const home = DATA.homes[key];
    const plan = plans[key];
    assert.deepStrictEqual(Array.from(PLAN.checkTour(plan, 3)), [], `${key}: the route keeps clear of walls and furniture`);

    // It begins just inside the front door.
    const entry = plan.openings.find((opening) => opening.type === 'entry');
    const start = home.tour[0].p;
    const doorAt = entry.o === 'v' ? [entry.c, (entry.a + entry.b) / 2] : [(entry.a + entry.b) / 2, entry.c];
    assert.ok(Math.hypot(start[0] - doorAt[0], start[1] - doorAt[1]) / PX < 1, `${key}: the tour starts within a metre of the front door`);

    // The camera as the film and the page move it: sampled 30 times a second.
    const tour = GUIDE.buildTour(home, (value) => value / PX, (value) => value / PX);
    const seen = new Set();
    let closest = Infinity;
    let fastestTurn = 0;
    let lastYaw = null;
    for (let time = 0; time <= tour.total; time += 1 / 30) {
      const pose = tour.pose(time);
      const x = pose.x * PX;
      const y = pose.z * PX;
      closest = Math.min(closest, plan.clearAt(x, y));
      const room = plan.roomAt(x, y);
      if (room) seen.add(room);
      if (lastYaw !== null) fastestTurn = Math.max(fastestTurn, Math.abs(pose.yaw - lastYaw) * 30);
      lastYaw = pose.yaw;
    }
    assert.ok(closest >= 2, `${key}: the camera never comes closer than ${closest} drawing pixels to a wall or furniture`);
    assert.ok(fastestTurn * 180 / Math.PI <= 100, `${key}: the camera never turns faster than 100° a second (${(fastestTurn * 180 / Math.PI).toFixed(0)})`);

    // Every room is either walked into or shown from its doorway with a label of its own.
    const stops = home.tour.filter((node) => node.stop && node.say); // a pause with nothing to say is only a breath before the camera rises
    const named = new Set(stops.map((stop) => stop.zone));
    const zoneRoom = (zone) => {
      const rects = home.zones && home.zones[zone] && home.zones[zone].rects;
      return rects ? plan.roomAt(rects[0][0] + 1, rects[0][1] + 1) : null;
    };
    const shown = new Set([...seen, ...[...named].map((zone) => (home.rooms.some((room) => room.id === zone) ? zone : zoneRoom(zone))).filter(Boolean)]);
    for (const room of home.rooms) assert.ok(shown.has(room.id), `${key}: the tour shows the ${room.name}`);

    // Each stop pauses long enough to read, and says one true thing about the room.
    for (const stop of stops) {
      assert.ok(stop.stop >= 1, `${key}: a pause of at least a second`);
      const words = TEXT.stop('en', key, stop.say);
      assert.ok(words && words.length > 12 && words.length < 110, `${key}: a short sentence for "${stop.say}"`);
      assert.ok(stop.zone === 'home' || plan.zones[stop.zone] || home.rooms.some((room) => room.id === stop.zone), `${key}: "${stop.zone}" is a room or part of one`);
    }
    assert.ok(stops.length >= home.rooms.length, `${key}: at least one stop per room`);
    assert.ok(tour.total > 40 && tour.total < 100, `${key}: the walk takes ${tour.total.toFixed(0)} seconds`);
    assert.ok(tour.rise > 2, `${key}: it ends by rising to the dollhouse view`);

    // A visitor can also walk to any stop from the front door on their own.
    for (const stop of stops.slice(1)) {
      assert.ok(GUIDE.findPath(plan, stops[0].p[0], stops[0].p[1], stop.p[0], stop.p[1]), `${key}: a walking route to ${stop.zone}`);
    }
  }
});

test('room sizes on the labels are worked out from the plan, in square feet and square metres', () => {
  assert.ok(Math.abs(PLAN.SQFT - 10.7639) < 0.001);
  for (const key of DATA.order) {
    const plan = plans[key];
    for (const id of Object.keys(plan.rooms)) {
      const room = plan.rooms[id];
      assert.ok(room.m2 > 2 && room.m2 < 60, `${key}: ${room.name} is ${room.m2.toFixed(1)} m²`);
      assert.ok(Math.abs(room.sqft - room.m2 * PLAN.SQFT) < 0.01);
    }
    const total = Object.keys(plan.rooms).reduce((sum, id) => sum + plan.rooms[id].m2, 0);
    assert.ok(Math.abs(total - (plan.netM2 + plan.balconyM2)) < 0.05, `${key}: rooms and balconies add up`);
  }
});

test('the welcome screen, the controls and the contact sheet are all in the page', () => {
  for (const id of ['view', 'welcome', 'w-name', 'w-address', 'w-size', 'w-price', 'btn-start', 'btn-explore', 'w-contact', 'w-close',
    'btn-tour', 'btn-view', 'btn-sound', 'btn-full', 'btn-contact', 'btn-close', 'homes', 'styles', 'time', 'time-label',
    'label', 'label-name', 'label-size', 'label-say', 'joy', 'contact', 'c-form', 'c-name', 'c-phone', 'c-msg', 'c-send', 'c-who', 'c-wa', 'fallback']) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id}`);
  }
  for (const style of ['modern', 'scandi', 'luxury']) assert.match(html, new RegExp(`data-style="${style}"`), `one-click ${style} style`);
  for (const key of DATA.order) assert.ok(html.split(`data-home="${key}"`).length >= 3, `${key} can be chosen on the welcome screen and from the tour`);
  assert.match(html, /<input id="time" type="range"/, 'the time-of-day slider');
  assert.match(html, /viewport-fit=cover/, 'fits phones with a notch');
  assert.match(html, /@media \(max-width: 760px\)/, 'a phone layout');

  // The words: English is complete, and anything another language lacks falls back to English.
  const english = TEXT.WORDS.en;
  for (const key of ['welcome.start', 'welcome.explore', 'tour.start', 'tour.pause', 'view.doll', 'view.walk', 'style.modern', 'style.scandi', 'style.luxury', 'label.time', 'btn.contact', 'contact.send', 'contact.sent', 'hint.walk', 'hint.walkTouch', 'hint.doll']) {
    assert.ok(english[key], key);
  }
  assert.equal(TEXT.pick('lg'), 'en', 'Luganda has no tour wording yet, so it gets English rather than a half-translated page');
  assert.equal(TEXT.say('sw', 'welcome.start'), 'Anza ziara');
  assert.equal(TEXT.say('sw', 'a.key.that.is.missing', null), '');
});

test('what the tour says about the project matches the listing', () => {
  const project = DATA.project;
  assert.equal(project.slug, vanta.slug);
  assert.equal(project.name, vanta.name);
  assert.equal(project.address, vanta.address);
  assert.equal(project.developer, vanta.developer_name);
  for (const unit of vanta.unit_types) {
    const mine = project.units[unit.key];
    assert.ok(mine, unit.key);
    assert.equal(mine.sizeSqm, unit.size_sqm);
    assert.equal(mine.priceUsd, unit.price_original);
    assert.equal(mine.priceUgx, unit.price_ugx);
  }
  assert.equal(Object.keys(project.units).length, vanta.unit_types.length);
});

test('the listing points at the new films, their posters and the tour, and the files exist', () => {
  const walkthroughs = vanta.extra_fields.walkthroughs;
  assert.deepStrictEqual(walkthroughs.map((item) => item.unit_key), ['1bhk', '2bhk', '3bhk']);
  for (const item of walkthroughs) {
    assert.equal(item.video_url, `/assets/off-plan/vanta-house/tour-${item.unit_key}.mp4`);
    assert.equal(item.poster_url, `/assets/off-plan/vanta-house/tour-${item.unit_key}-poster.jpg`);
    assert.equal(item.tour_url, '/off-plan/vanta-house/tour');
    for (const url of [item.video_url, item.poster_url]) {
      const file = path.join(root, url.replace(/^\//, ''));
      assert.ok(fs.existsSync(file), url);
      assert.ok(fs.statSync(file).size > 20000, `${url} is a real file`);
    }
    const film = fs.readFileSync(path.join(root, item.video_url.replace(/^\//, '')));
    assert.equal(film.subarray(4, 8).toString('latin1'), 'ftyp', `${item.video_url} is an MP4`);
    assert.ok(film.indexOf(Buffer.from('moov')) < film.indexOf(Buffer.from('mdat')), `${item.video_url} starts playing before it has finished downloading`);
    assert.ok(film.length < 16 * 1024 * 1024, `${item.video_url} stays under 16 MB`);
    assert.ok(item.duration_seconds >= 50 && item.duration_seconds <= 110);
  }
  assert.match(html, /og:image" content="https:\/\/makaug\.com\/assets\/off-plan\/vanta-house\/tour-2bhk-poster\.jpg"/, 'a shared link shows a picture from the tour');
});

test('the project page opens the tour as a page of its own, for the home that was chosen', () => {
  const walk = client.slice(client.indexOf('function homesWalkthroughMarkup(project)'), client.indexOf('function constructionDiaryMarkup('));
  assert.match(walk, /const tourPath = \/\^\\\/off-plan\\\/\[a-z0-9-\]\+\\\/tour\$\/\.test\(clean\(item\.tour_url\)\) \? clean\(item\.tour_url\) : '';/, 'only a makaug tour address is ever linked');
  assert.match(walk, /\$\{tourPath\}\?home=\$\{encodeURIComponent\(clean\(item\.unit_key\)\)\}&lang=\$\{encodeURIComponent\(offPlanLanguage\(\)\)\}&back=1/);
  assert.match(walk, /data-no-spa="true" data-off-plan-tour=/, 'the link is left to the browser');
  assert.match(app, /anchor\.dataset\.noSpa === "true"/, 'and the site\'s own link handling steps aside for it');
  assert.match(walk, /openOffPlanWalkaround\('\$\{escapeHtml\(item\.unit_key\)\}'\)/, 'projects without a tour keep the simple viewer');

  // Coming back, the visitor lands on the homes section they left from: a note for this tab, used once.
  assert.match(walk, /onclick="noteOffPlanTourVisit\('\$\{escapeHtml\(project\.slug\)\}'\)"/);
  const back = client.slice(client.indexOf("const TOUR_RETURN_KEY = 'makaugOffPlanTourReturn';"), client.indexOf('async function openOffPlanDetail('));
  assert.match(back, /window\.sessionStorage\.removeItem\(TOUR_RETURN_KEY\); \} catch/, 'the note is dropped as soon as it is read');
  assert.match(back, /note\.slug !== clean\(project\?\.slug\) \|\| !\(Date\.now\(\) - Number\(note\.at\) < 30 \* 60 \* 1000\)/, 'only for the same project, within half an hour');
  assert.match(back, /document\.getElementById\('off-plan-walk-section'\)/);
  assert.match(back, /if \(event\.persisted\)/, 'a page restored whole needs no note');
  assert.match(back, /hydrateOffPlanExperience\(project\);\n    returnFromOffPlanTour\(project\);/);
  assert.match(client, /markOffPlanProjectUpdate, noteOffPlanTourVisit, /, 'the link can reach it');
  const appPart = inline[8];
  assert.match(appPart, /if \(qs\.get\('back'\) === '1' && window\.history\.length > 1\) window\.history\.back\(\); else window\.location\.href = project\.pagePath/, 'the close button goes back to the listing the visitor came from, or to the listing when opened on its own');
  assert.doesNotMatch(appPart, /document\.referrer/, 'the site sends no referrer, so the tour never relies on one');
  assert.match(appPart, /D\.homes\[qs\.get\('home'\)\]/, 'the home in the link is the one shown first');
});
