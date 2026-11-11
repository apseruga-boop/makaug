# The agents' brief (Morning Brief)

A 30-second WhatsApp video for every approved agent. It covers five Uganda property stories, and after each one, what it means for how agents make money. The caption carries a link to each article.

Arthur asked for it on 11 Nov 2026. The first one went out that afternoon as an Afternoon Brief. From 12 Nov a Morning Brief reaches the agents at 7:00am Kampala time.

## 1. Write the edition

`editions/YYYY-MM-DD.json` holds one edition:

```json
{
  "date": "2026-11-12",
  "short": "Thu 12 Nov 2026",
  "long": "Thursday 12 November 2026",
  "label": "MORNING BRIEF",
  "emoji": "☀️",
  "slot": "morning",
  "stories": [ { "chip": "SHOPS", "emoji": "🏬", "title": "…", "story": "…", "you": "…", "source": "Source: New Vision · 11 Nov 2026" } ],
  "caption": "☀️ *makaug Morning Brief* · Thu 12 Nov\n…\nReply STOP if you don't want the brief.\nPhillip, makaug.com"
}
```

- Use exactly five stories. Pick the news most likely to change how agents make money: rates and loans, land titles and fraud, rules and fees, evictions, prices and demand. Prefer the last few days, and never repeat a story from an earlier edition.
- Each card is read in about five seconds, so keep it short. The `title` is a few words. The `story` is the fact, with its numbers, in about 15–20 words. The `you` line is what the agent should do, in about 12–15 words. `<b>` and `<span class="hl">` mark the words that matter.
- Check every number against the article, and name the outlet and date in `source`.
- The caption has one line and one link per story. It must stay within WhatsApp's 1,024 characters, offer STOP, and be signed by Phillip. The server refuses a caption that does not.

## 2. Render

```bash
node scripts/agent-brief/scenes.js scripts/agent-brief/editions/2026-11-12.json /tmp/brief-1112
scripts/agent-brief/render.sh /tmp/brief-1112 makaug-morning-brief-2026-11-12.mp4
```

The output is 1080×1920 at 30 fps and 30 seconds long: a 2-second title card, five 5.2-second stories, then a 2-second close. Each story shows first, then "What it means for you" fades in. Look at the stills before sending; `scenes.js` prints `LAYOUT:` if text runs into the panel or the footer.

## 3. Host and send

1. Add the video under `assets/marketing/morning-brief/` with a random suffix, and ship it.
2. `POST /api/admin/agent-broadcast/brief/preview` with `{ date, slot, video_url, caption, to: [Arthur, Ronald] }` sends it to them first.
3. `POST /api/admin/agent-broadcast/brief/schedule` with `{ date, slot, video_url, caption, confirm: "SEND_TO_ALL_AGENTS" }` sends it to every approved agent. A morning brief waits in the queue until 7:00am Kampala time, and the messages go 15 seconds apart. Agents who replied STOP are left out, and so is anyone Arthur said never to message. No agent gets the same brief twice.
4. `GET /api/admin/agent-broadcast/brief?date=…&slot=…` shows who it goes to and where it stands. `POST /api/admin/agent-broadcast/brief/hold` withdraws whatever has not gone yet.
