# The makaug films

Four short films that go out on WhatsApp from the Agent 007 menu. They were
made on 14 Nov 2026 to replace the earlier explainer films, which used drawn
pictures. These use real makaug.com pages, a real listing and the assistant's
own replies, because people who are asked to pay want to see the thing working.

| Film | File in `assets/marketing/` | Who gets it | How it is sent |
| --- | --- | --- | --- |
| Agent intro | `makaug-agent-intro-v5.mp4` | An agent who has not joined | Agent 007 → 3, or with a prospect's payment link |
| Owner intro | `makaug-owner-intro-v1.mp4` | Someone selling or letting their own property | Agent 007 → 4 |
| How to post (agents) | `makaug-agent-how-to-post-v3.mp4` | An approved agent | Agent 007 → 5 → 1 |
| How to list (owners) | `makaug-owner-how-to-list-v5.mp4` | An owner | Agent 007 → 5 → 2, by itself when an owner replies LIST to the owner film, and when somebody picks 1, List my property, on the menu |

The paths and captions are in `EXPLAINER_VIDEOS` in `routes/whatsapp.js`. Each has a Luganda
(`-lg.mp4`) and a Swahili (`-sw.mp4`) twin beside it; see below.

## Rendering

    node scripts/films/render.js agent-intro
    node scripts/films/render.js owner-intro --stills 12,40.5     # look at two moments first
    node scripts/films/render.js agent-howto --scene 2            # one scene again, then re-joined
    node scripts/films/render.js owner-howto --music              # with the music bed

It needs Node with Playwright (or `playwright-core` and `CHROME_PATH`) and
ffmpeg. A film takes about two minutes. Each scene is photographed frame by
frame into its own file under `.build/`, and the files are joined without
re-encoding. The result is 720x1280, 30 frames a second, H.264, 6 MB or less.
`FILM_SCALE=1.5` draws the same film at 1080x1920 (full HD, about five
minutes); the how-to-list film (v5, 16 Nov 2026) is made that way, about
6 MB.

The films are silent: Arthur asked for that on 14 Nov 2026. They carry an
empty sound track so every phone treats them as a video. `--music` lays a
quiet bed under the picture instead (`music.py`, which needs python3 with
numpy).

## How a film is put together

`film.html?film=agent-intro&t=12.5` draws that film at 12.5 seconds in any
browser, which is the quickest way to look at a change. `engine.js` holds the
timeline and the builders (`chat`, `page`, `convo`, `head`); `film.css` is the
look; each file in `films/` is one film, scene by scene. Text is written in the
film file.

## Luganda and Swahili

Each film has a Luganda and a Swahili twin, with `-lg` or `-sw` before `.mp4`:

    node scripts/films/render.js owner-intro --lang lg     # makaug-owner-intro-v1-lg.mp4
    node scripts/films/render.js owner-intro --lang sw --stills 12,40.5
    node scripts/films/render.js owner-intro --texts       # the English lines, in order

The words on screen are looked up in `lang/lg.js` and `lang/sw.js`: the English
line on the left, what the film shows on the right. To change a line, change
the right-hand side and render that film again. A line that is not in the file
stays in English. Headlines that come out longer than the English are set
smaller until they fit their two lines, and a block that grows pushes down the
block under it (`fit()` in `engine.js`); look at stills of a changed scene
before rendering.

Three things are left in English on purpose:

- **The chat.** It is what the assistant really sends, and the assistant
  answers agents in English only. Its Luganda and Swahili for owners is partial
  (`transcript.lg.js` and `transcript.sw.js` are what it said on 14 Nov 2026,
  from `node scripts/films/capture.js lg`), so the films show the English chat
  and say so to the staff member who sends one.
- **The words people reply with** (LIST, AGENT, AGREE, SOLD, STATUS, SHARE,
  HELP, REMOVE), because those are the words the assistant answers.
- **Screenshots of makaug.com**, which are photographs of the English site.

The translations were written on 14 Nov 2026 and need a read by a native
speaker before the films are sent widely. `tests/film-languages.test.js` checks
that every translated line keeps the markup, the reply words, the money and the
codes of its English line.

A staff member asks for a twin with one more word after the number, at Agent
007 → 3, 4 or 5: `Sarah Nakato | 0772123456 | Luganda`. The message that goes
with the film is then in that language too (`services/filmLanguageService.js`).
Nothing added is English.

## What is real

- **The pages** are screenshots of makaug.com taken on 14 Nov 2026 with a phone
  profile (360 CSS pixels wide, twice the density): the home page, the listing
  for the 3-bed bungalow in Buwaate, Kimuli Brian's agent page, the 2-bed house
  in Seeta, and the Vanta House off-plan page. They scroll; nothing on them is
  redrawn. The bar pinned to the bottom of a listing has the phone number
  covered except its last three digits.
- **The brochures** are page 1 of the Vanta House brochure as the site prints
  it in English, Luganda and Swahili.
- **The assistant's words** (`transcript.js`) were captured by sending each
  message through the real inbound route, `POST /api/whatsapp/web-bridge/inbound`,
  against a scratch database, and are printed as they came back. `capture.js`
  is the script; it refuses to run against anything but a local database.
- **The photos** are the listings' own.
- **The payment card** is the one `services/momoMerchantCardService.js` draws.
- **The two small phone screens** in the agent film are frames from films
  makaug has already sent to agents (a weekly showcase and a Morning Brief).

## What was adapted, and what is an example

- Links, references and the payment-page code are filled in: the scratch run
  made its own. The title in the agent's "live" message reads as it does on the
  real page ("3-bed bungalow"); the scratch run wrote "3-bed property".
- In the how-to film for agents the price is corrected to 285m to show a
  correction, so the messages after it say 285m. The real listing is 290m.
- The owner, "Sarah Nakato", is an example. Her questions and the assistant's
  answers are real; the page shown afterwards is a real listing, and the film
  says it is an agent's.
- The enquiry from "Grace" is an example of the message a lister receives.
- The ID photo is a blank card shape, blurred. No real ID was used.
- The owner's conversation runs faster than life, and the film says so.

## Where each claim comes from

| On screen | Source |
| --- | --- |
| 4,700+ properties; "4,708 on 14 Nov 2026" | The count printed on the home page that day |
| 9 languages | The site's own language bar; the assistant's nine in `languageComfortLine` |
| Countries where listings were opened | `agentWelcomeService.computePlatformStats` (30 days to 14 Nov 2026). Only the countries are named. The totals are left out because part of the traffic is data-centre traffic, not people |
| 107 properties live on one agent's page | That agent's page, 14 Nov 2026 |
| UGX 50,000 a month (agents); UGX 20,000 a month per property (owners); no commission | `config/publishedPricing.js` and the lister terms |
| MoMo merchant code 27248497, `*165*3#` | `config/momoMerchant.js` |
| Weekly report; Morning Brief at 7am | `agentWeeklyReportService` (sent by the team from the King each week) and `agentBriefBroadcastService` |
| SOLD shows for 7 days, then comes off, and the lister is told | `utils/publicInventoryStatus.js`, `ownerListingCommandService.runSoldOffNotices` |
| REMOVE, STATUS, HELP for owners | `services/ownerListingCommandService.js` |
| "Usually within 24 hours" | The assistant's own submitted message |
| Title search, written agreement, payment through the bank | General guidance, and the film says it is not legal advice |
| "An unpaid listing can be taken off until you pay" | Reminders are automatic; taking a listing off is done by the team in the King |

## Before a film goes out

The films show a real agent's name, photo and page, a real company's listing,
and a developer's project page. All are public on makaug.com. Kimuli Brian and
John Yan of Vanta House are happy to be shown (Arthur, 14 Nov 2026). The 2-bed
house in Seeta in the two owner films is a listing by another agency, which has
not been asked; swap it for one of Brian's listings if that matters.
