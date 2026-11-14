/*
 * The makaug assistant's own words, captured on 2026-11-14 by sending these
 * messages through the real WhatsApp inbound route (routes/whatsapp.js) against
 * a scratch database: scripts/films/capture.js. The films print them as they
 * came back. {id}, {agent}, {code}, {ref} and {number} stand for the run's own
 * links, reference and phone number.
 */
window.T = {
 "agent_hello": {
  "said": "Hello",
  "reply": "👋 Hello Brian!\n\nWhat would you like to do?\n\n1️⃣ *Post a property* — just send it here with photos and a caption\n2️⃣ *Share my listings* — reply *SHARE* for your link and card\n3️⃣ *Check a property* — reply *STATUS* to see where yours are\n4️⃣ *Talk to a person* — reply *HELP*\n5️⃣ *List a short stay* (by the night) — reply *SHORT STAY*\n\n_Or just send the property straight away — you do not need the menu._"
 },
 "agent_post": {
  "said": "Buwaate 3 bedroom bungalow for sale\nSize 13 decimals - Price 290M\nNeeds some renovations",
  "reply": "Thanks Brian 👇\n\n✅ *Saved — your property in Buwaate is with our team for review.*\n\n🏠 3 bedroom bungalow · for sale\n📍 Buwaate, Wakiso\n💰 UGX 290,000,000\n📸 1 photo saved — send more and I will add them to this one\n\nAnything wrong? Just reply with the correction — e.g. _price 1.5m_ or _area Najjera, Wakiso_.\n\nAs soon as it is approved it goes live under your name and I will send you the link to share.\n\nNext property? Send it the same way — one property per message."
 },
 "agent_photo2": {
  "said": "",
  "reply": ""
 },
 "agent_photo3": {
  "said": "",
  "reply": ""
 },
 "agent_status_pending": {
  "said": "STATUS",
  "reply": "📋 *Your properties (last 60 days)*\n\n⏳ *1 with our team for review*\n• 3-bed property for sale in Buwaate\n\nI message you the link the moment each one goes live."
 },
 "agent_fix_buwaate": {
  "said": "price 285m",
  "reply": "✏️ *Updated* — 💰 price is now UGX 285,000,000.\n\nIt is still with our team for review. I will send you the link when it is live."
 },
 "agent_post2": {
  "said": "2 bedroom house for rent in Kira, Wakiso. UGX 900k per month",
  "reply": "✅ *Saved — your property in Kira is with our team for review.*\n\n🏠 2 bedroom house · for rent\n📍 Kira, Wakiso\n💰 UGX 900,000 a month\n📸 1 photo saved — send more and I will add them to this one\n\nAnything wrong? Just reply with the correction — e.g. _price 1.5m_ or _area Najjera, Wakiso_.\n\nAs soon as it is approved it goes live under your name and I will send you the link to share.\n\nNext property? Send it the same way — one property per message."
 },
 "agent_fix": {
  "said": "price 850k",
  "reply": "✏️ *Updated* — 💰 price is now UGX 850,000.\n\nIt is still with our team for review. I will send you the link when it is live."
 },
 "agent_live": {
  "reply": "🎉 *Your property is live on makaug.com*\n3-bed property for sale in Buwaate\nBuwaate, Wakiso · USh 290,000,000\n🔗 https://makaug.com/property/{id}\n\n👤 Your profile page is updated with it:\nhttps://makaug.com/agents/{agent}\n\nShare both on your WhatsApp status and in your groups — buyers see your name and number.\nGot another one? Send it here."
 },
 "agent_enquiry": {
  "reply": "New enquiry from makaug.com\n\nProperty: 3-bed property for sale in Buwaate (MK-{ref})\nhttps://makaug.com/property/{id}\n\nName: Grace\nPhone / WhatsApp: +44 7••• ••• 418\n\nMessage: \"Is it still available? I am in London and my brother can view it on Saturday.\"\n\nPlease contact them directly. makaug.com passes enquiries on and does not take part in the conversation."
 },
 "agent_status_live": {
  "said": "STATUS",
  "reply": "📋 *Your properties (last 60 days)*\n\n⏳ *1 with our team for review*\n• 2-bed property for rent in Kira\n\n✅ *1 live*\n• 3-bed property for sale in Buwaate — https://makaug.com/property/{id}\n\nI message you the link the moment each one goes live.",
  "also": [
   {
    "text": "🏡 3-bed property for sale in Buwaate\n📍 Buwaate, Wakiso\n🏷️ For Sale\n💰 USh 290M\n🔗 View photos, map & enquire: https://makaug.com/property/{id}\n🔎 View all properties: https://makaug.com",
    "media": "photo"
   }
  ]
 },
 "agent_share": {
  "said": "SHARE",
  "reply": "📢 *Your makaug page, Brian*\n\nhttps://makaug.com/agents/{agent}\n\nEverything you have live sits on that one page, with your name and number on it. Send it to a buyer, put it on your status, drop it in your groups.\n\n*Tap to share it now:*\nhttps://wa.me/?text=…\n\n🖼️ *Your agent card* — save this and post it on your WhatsApp status:\nhttps://makaug.com/api/agents/share-card/{agent}.png"
 },
 "agent_myphoto": {
  "said": "my photo",
  "reply": "Sorry about that, Brian. Let us fix it now. 📸\n\nPlease send the image you would like on your makaug profile — a clear photo of *you*, or your company *logo*, whichever you want buyers to see.\n\nJust send the picture here in this chat. I will tidy it up, put it on your profile, and message you again the moment it is live.\n\nPlease do not send an ID card — it can never go on a public profile.\nReply *CANCEL* to leave it for now."
 },
 "agent_myphoto_cancel": {
  "said": "cancel",
  "reply": "No problem — send *my photo* any time and we will do it then. You can keep sending properties here."
 },
 "agent_help": {
  "said": "HELP",
  "reply": "🙋 No problem Brian — help is on the way.\n\nI have let *Ronald* from our team know, and he will get back to you. If it is urgent, call or WhatsApp Ronald directly on *+256 709 402 189*.\n\nIf it is about a property, you can still send it here as normal — photos and a caption — and it will be saved."
 },
 "agent_sold": {
  "said": "The Buwaate bungalow is sold",
  "reply": "🏷️ *Sold? Let me mark it.*\n\n*3-bed property for sale in Buwaate* — Buwaate, Wakiso · USh 290M\n🔗 https://makaug.com/property/{id}\n\nReply *1* = Yes, mark it SOLD\nReply *2* = No, it is a different property",
  "also": [
   {
    "text": "🏷️ *Sold? Let me mark it.*\n\n*3-bed property for sale in Buwaate* — Buwaate, Wakiso · USh 290M\n🔗 https://makaug.com/property/{id}\n\nReply *1* = Yes, mark it SOLD\nReply *2* = No, it is a different property",
    "media": "photo"
   }
  ]
 },
 "agent_sold_yes": {
  "said": "1",
  "reply": "✅ *Marked as SOLD* — 3-bed property for sale in Buwaate\n🔗 https://makaug.com/property/{id}\n\nIt stays on makaug with a SOLD badge for 7 days, then comes off the site by itself. I will message you the day it does. Congratulations, Brian! 🎉"
 },
 "owner_list": {
  "said": "LIST",
  "reply": "🏠 Kyoyetaagadde okutereka kya ki?\n1️⃣ Enju/Ensi okutunda\n2️⃣ Enju okusasula\n3️⃣ Ttaka\n4️⃣ Eby'okulala by'abayizi\n5️⃣ Ensi ez'ebikolwa\n6️⃣ Short stays (okusula okumpi)\n\nShort stays (okusula okumpi): abatali ba agent basasula UGX 20,000 buli mwezi, tewali nnaku za bwereere. Ba agent abakkirizibwa bafuna short stays mu pulani ya UGX 50,000 buli mwezi.",
  "also": [
   {
    "text": "🎬 *How to list your property on makaug* — step by step, about 5 minutes: answer a few short questions, send your photos, confirm it's you and agree to the terms. Our team checks it and you get the link when it is live. UGX 20,000 a month per property — we send you how to pay, nothing is charged automatically.",
    "media": "makaug-owner-how-to-list-v4.mp4"
   }
  ]
 },
 "owner_type": {
  "said": "1",
  "reply": "✅ Ggwe nnyini ensi ono oba agent?\n1️⃣ Nze nnyini\n2️⃣ Nze agent"
 },
 "owner_ownership": {
  "said": "1",
  "reply": "✅ Saved\n\nNext: ✏️ Nyumba yoyo ejjiire etya? (e.g. \"Enyumba esatu Ntinda Kampala\"):"
 },
 "owner_title": {
  "said": "2 bedroom house in Seeta",
  "reply": "✅ Saved: title | Seeta, Mukono | 2 bedrooms\n\nNext: 💰 Ebbeeyi yayo mu Shillingi za Uganda bwoba nyo? (ennamba zokka)"
 },
 "owner_price": {
  "said": "155m",
  "reply": "✅ Saved: USh 155,000,000\n\n📸 Weereza waakiri ebifaananyi 2 ebitegeerekeka eby'ennyumba (okutuuka ku 10). Osobola okubisindika kimu ku kimu oba wamu. Ebisinga obulungi: front/outside, sitting room, bedroom, kitchen ne bathroom. Screenshot, document oba ekifaananyi ekiddiddwa tekibalibwa.\n\nTandika n'ekifaananyi kya *front/outside*."
 },
 "owner_photo1": {
  "said": "",
  "reply": "✅ Ekifaananyi 1 kikkiriziddwa. Ebifaananyi ebikulu 1 bisigadde.\n📸 Ekiddako: weereza ekifaananyi kya *sitting room oba ekisenge ekikulu*."
 },
 "owner_photo2": {
  "said": "",
  "reply": "✅ Ekifaananyi 2 kikkiriziddwa — bimala okuteeka listing.\n📸 Weereza ebirala bw'oba obirina (okutuuka ku 8), oba wandiika *DONE* okugenda mu maaso."
 },
 "owner_photo3": {
  "said": "",
  "reply": "✅ Ekifaananyi 3 kikkiriziddwa — bimala okuteeka listing.\n📸 Weereza ebirala bw'oba obirina (okutuuka ku 7), oba wandiika *DONE* okugenda mu maaso."
 },
 "owner_done": {
  "said": "DONE",
  "reply": "📸 Ebifaananyi 3 bifuniddwa — weebale.\n\n👤 What public contact name should appear on the listing? (For example: Amina, Amina Properties, or Private Owner)"
 },
 "owner_name": {
  "said": "Sarah Nakato",
  "reply": "Abalabi bakukubire ku *{number}*, ennamba ya WhatsApp gy'okozesa kati? Ddamu *YES* oba *NO*."
 },
 "owner_contact": {
  "said": "YES",
  "reply": "🤳 Weereza ekifaananyi kyo ekirabika obulungi ng'okutte National ID yo. Tosindika PDF oba document file; kyetaagisa kubeera kifaananyi.\n\n🔒 ID yo ya kukakasa kwokka — tegirabikira ku makaug era tegiweebwa muntu yenna."
 },
 "owner_id_photo": {
  "said": "",
  "reply": "🪪 Kwa nteekateeka, tukeetaaga NIN yo (National ID Number).\n\n🔒 Kino kya kukakasa nti ggwe nnannyini yennyini — tekirabikira ku makaug era tekiweebwa muntu yenna."
 },
 "owner_nin": {
  "said": "(their NIN)",
  "reply": "📄 *One last step, Sarah — our terms*\n\n• It is *UGX 20,000 per listing, per month* from the day it goes live.\n• Nothing is charged automatically. We send you how to pay, and the listing stays live once that month is paid.\n• A short stay (by the night) is *UGX 20,000 a month*, with *no free days*. Approved agents include short stays in the agent plan.\n• Your ID is only for checking — it is *never shown* to anyone.\n• makaug advertises your property; the deal itself is between you and the buyer or tenant.\n\nRead the full terms (PDF): https://makaug.com/legal/makaug-private-lister-terms.pdf?v=2026-11-11-v4\n\nReply *AGREE* to accept and send your property for review, or *NO* if you don't want to continue.",
  "also": [
   {
    "text": "📄 makaug — Terms for listing your property",
    "media": "makaug-private-lister-terms-cover.png?v=2026-11-11-v4"
   }
  ]
 },
 "owner_agree": {
  "said": "AGREE",
  "reply": "🎉 *Ensi yo eterekedwa!*\n\nTeemu yaffe eya kulabirira era ejja kuterekebwa mu saawa 24.\n\nReference: MK-{ref}\n\n✅ Edirirra: teekawo profile yo olabe views, saves n'ebibuuza ku listing yo.\n\nWebale okozesa makaug! 🏠🇺🇬\n\nOnce approved: https://makaug.com/property/{id}\nTo remove it later, reply *REMOVE MK-{ref}* from this WhatsApp number.\n\n✅ Thank you for agreeing to the terms.\n🗓️ Once our team approves it, your property goes live and I send you the payment link: *UGX 20,000 a month* keeps it live. Nothing is charged automatically."
 },
 "owner_status_pending": {
  "said": "STATUS",
  "reply": "📋 *Your property on makaug, Sarah*\n\n*2 Bedroom House In Seeta (MK-{ref})*\n⏳ With our team for review. I message you the link the moment it is live.\n\nSold or let it? Reply *SOLD*. Want it off the site? Reply *REMOVE*. Another one to list? Reply *LIST*."
 },
 "owner_live": {
  "also": [
   {
    "text": "Great news Sarah Nakato - your listing is *live* on makaug 🎉\n2 Bedroom House In Seeta - Seeta, Mukono - USh 155,000,000\nView & share: https://makaug.com/property/{id}\n\n💳 To keep it live it is *UGX 20,000 a month*.\n📱 *Pay with MTN MoMo:* dial ```*165*3#```, choose *1* (Merchant Code), enter *27248497*, then *UGX 20,000* and your MoMo PIN.\nThen reply here with your name (or business name) and we will confirm it.\nYour payment page: https://makaug.com/pay/{code}\nNothing is charged automatically.\n\nTo remove it, reply REMOVE MK-{ref} from the WhatsApp number used to submit it.\nSold or let it? Reply SOLD. To check on it, reply STATUS.",
    "media": ""
   },
   {
    "text": "💳 How to pay: MoMo merchant code *27248497* — keep this card.",
    "media": "momo-card.png?v=1"
   }
  ]
 },
 "owner_status_live": {
  "said": "STATUS",
  "reply": "📋 *Your property on makaug, Sarah*\n\n*2 Bedroom House In Seeta (MK-{ref})*\n✅ Live. The first month (UGX 20,000) is not paid yet.\nhttps://makaug.com/property/{id}\n\nSold or let it? Reply *SOLD*. Want it off the site? Reply *REMOVE*. Another one to list? Reply *LIST*."
 },
 "owner_help": {
  "said": "HELP",
  "reply": "🙋 No problem Sarah, help is on the way.\n\nI have let *Ronald* from our team know, and he will get back to you. If it is urgent, call or WhatsApp Ronald directly on *+256 709 402 189*."
 },
 "owner_remove": {
  "said": "REMOVE",
  "reply": "🗑️ Take *2 Bedroom House In Seeta (MK-{ref})* off makaug?\n\nReply *YES* to remove it, or *NO* to keep it.\n\n_If it has sold or been let, reply *SOLD* instead: it shows a SOLD badge for 7 days first, which tells buyers you close deals._"
 },
 "owner_remove_no": {
  "said": "NO",
  "reply": "Okay, nothing changed. Your listing stays as it is."
 },
 "owner_sold": {
  "said": "SOLD",
  "reply": "🏷️ *Sold? Let me mark it.*\n\n*2 Bedroom House In Seeta* — Seeta, Mukono · USh 155M\n🔗 https://makaug.com/property/{id}\n\nReply *1* = Yes, mark it SOLD\nReply *2* = No, it is a different property"
 },
 "owner_sold_yes": {
  "said": "1",
  "reply": "✅ *Marked as SOLD* — 2 Bedroom House In Seeta\n🔗 https://makaug.com/property/{id}\n\nIt stays on makaug with a SOLD badge for 7 days, then comes off the site by itself. I will message you the day it does. Congratulations! 🎉"
 },
 "owner_status_sold": {
  "said": "STATUS",
  "reply": "📋 *Your property on makaug, Sarah*\n\n*2 Bedroom House In Seeta (MK-{ref})*\n🏷️ Marked SOLD. It shows a SOLD badge for 7 days, then comes off the site.\n\nAnother property to list? Reply *LIST*."
 }
};
