# Walkthroughs for agents' off-plan projects

Since 27 Nov 2026 agents are told (in the walkthrough film and on WhatsApp) to
send their off-plan projects with the floor plan of each home type, and that
makaug makes the walkthrough video and the 3D walk-around from those plans as
part of their plan. This is how a request moves, and what the team does.

## The loop

1. **The agent sends the project** to the makaug WhatsApp: its name, place, home
   types with sizes and prices, completion and payment plan. Agent 007 reads it
   as off-plan (`employeeCaptionLooksOffPlan`), saves a review listing and opens
   a draft on the off-plan desk. Without floor plans, the saved reply asks for
   them ("🎬 Walkthrough video — included in your plan…"). An agent who only asks
   ("how do I send my off-plan project?", "walkthrough") is told what to send,
   and the team hears who asked.
2. **The floor plans arrive**, with the project or after it: a photo the photo
   check calls a floor plan (`floor_plan` in `classifyWhatsappListingPhoto`), a
   file or reason that names one, or a PDF in an off-plan project's messages.
   `services/offPlanWalkthroughRequestService.js` (`requestWalkthrough`):
   - keeps them on the project (its floor plans while it is in review; on a
     live page they wait in the project update until staff accept it),
   - opens a walkthrough job on the off-plan desk ("Brief ready · awaiting
     render"), or adds them to the open one,
   - tells the team: "🎬 *Walkthrough to make — <project>*" with the plans,
   - thanks the agent when they sent the plans after the project ("🎬 Got the
     floor plan for …"); with the project, the saved reply says it.
3. **The team makes the walkthrough** (below), adds the video on the off-plan
   desk ("Add rendered video") and approves it.
4. **The agent is told**: approving the job (`PATCH /walkthroughs/:id`, status
   `approved`) sends the agent who asked the link on WhatsApp, once
   (`notifyWalkthroughReady`), and the team hears it went. Like everything the
   makaug number sends, it waits until the agent has written in the last 7
   days, and never goes between 22:00 and 07:00. A brief staff open themselves
   sends nobody anything.

## Making the walkthrough

Vanta House (`assets/off-plan/vanta-house/`) is the model to copy.

1. Read each floor plan into a concept layout in metres:
   `assets/off-plan/<slug>/walkthrough-layouts.json`, one unit per home type
   (`rooms`, `walls` with door and window openings, `furniture`, `lights`, the
   camera `path`). The note says the developer's finishes and dimensions govern.
2. Copy `assets/off-plan/vanta-house/tour.html` for the project and point it at
   the new layouts.
3. Film each home: `node scripts/off-plan-tour-film.js <slug> <home> <style> [clock]`
   writes `tour-<home>.mp4` and its poster beside the tour page.
4. Put the films on the project (`extra_fields.walkthroughs`: `unit_key`,
   `video_url`, `poster_url`, `tour_url` `/off-plan/<slug>/tour?home=<home>`,
   `layout_url`, `label`), add the video to the walkthrough job and approve it.
