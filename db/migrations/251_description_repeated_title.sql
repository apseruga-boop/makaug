-- 22 Nov 2026: every save in King's review rebuilt the description from the
-- title, the description and the source caption joined together, then cut it
-- at 420 characters. So each save put the title in front again (sometimes
-- after a lead sentence: "5-bed house for rent in Seguku. 5-bed property for
-- rent in Seguku Rental property in Seguku, Wakiso, listed at…"), added the
-- caption again at the end, and cut the end off ("…full specifications
-- and…"). 9 of the 20 newest live listings had it. The save is fixed in
-- utils/pastedListingCopy.js.
--
-- This repairs the descriptions it hit, live and waiting for review:
--   1. the copies in front go (the title repeated, a lead sentence and the
--      title, or the same phrase twice);
--   2. on a WhatsApp intake description, a caption added again after the
--      last sentence ("…viewing arrangements. <the caption again>") goes,
--      only when that text is already in the description;
--   3. a description cut inside one of the intake's own sentences ("Watch the
--      attached video tour…", "Contact … to confirm current availability…")
--      gets the rest of that sentence back, and a found-online description
--      cut inside "The source post is titled …" gets its source title back.
-- Nothing else in a description changes, the old text is kept in the event,
-- and nobody is sent anything.
DO $$
DECLARE
  r RECORD;
  t TEXT;
  tl TEXT;
  d TEXT;
  before_text TEXT;
  prev TEXT;
  x TEXT;
  m TEXT[];
  steps TEXT[];
  i INT;
  pos INT;
  lastpos INT;
  head TEXT;
  tail TEXT;
  core TEXT;
  body TEXT;
  frag TEXT;
  rest TEXT;
  n INT;
  contact TEXT;
  s TEXT;
BEGIN
  FOR r IN
    SELECT id, title, description, source, lister_name, extra_fields
      FROM properties
     WHERE status IN ('approved', 'pending')
       AND length(btrim(COALESCE(title, ''))) >= 8
       AND COALESCE(description, '') <> ''
  LOOP
    t := btrim(r.title);
    tl := lower(t);
    d := r.description;
    before_text := d;
    steps := ARRAY[]::TEXT[];

    -- 1. The front.
    FOR i IN 1..12 LOOP
      prev := d;
      IF lower(left(d, 2 * length(t) + 1)) = tl || ' ' || tl THEN
        -- "Land for sale in Kira Land for sale in Kira, Wakiso…"
        d := substr(d, length(t) + 2);
        steps := steps || 'title_repeated'::TEXT;
      ELSE
        -- "4-bed house for rent in Kira. 4-bed property for rent in Kira Rental property in Kira, Wakiso…"
        x := substring(d from '^([^.]{3,90})\. ');
        IF x IS NOT NULL
           AND x ~* '^(?:\d+-bed )?[a-z][a-z -]{1,40} (?:for sale|for rent|to let|to rent|for lease) in [^.]{2,60}$'
           AND lower(substr(d, length(x) + 3, length(t) + 1)) = tl || ' '
           AND substr(d, length(x) + length(t) + 4, 1) ~ '[A-Z0-9]' THEN
          d := substr(d, length(x) + length(t) + 4);
          steps := steps || 'lead_and_title'::TEXT;
        ELSE
          -- "Apartment for sale in Kyanja Apartment for sale in Kyanja is a property…"
          m := regexp_match(d, '^(.{8,90}?) \1(?=[ ,.])', 'i');
          IF m IS NOT NULL AND position(' in ' in lower(m[1])) > 0 THEN
            d := substr(d, length(m[1]) + 2);
            steps := steps || 'phrase_repeated'::TEXT;
          END IF;
        END IF;
      END IF;
      EXIT WHEN d = prev;
    END LOOP;

    IF r.source = 'whatsapp_employee_intake' THEN
      -- 2. The caption again after the last sentence.
      lastpos := 0;
      LOOP
        pos := strpos(substr(d, lastpos + 1), 'viewing arrangements.');
        EXIT WHEN pos = 0;
        lastpos := lastpos + pos;
      END LOOP;
      IF lastpos > 0 THEN
        head := left(d, lastpos - 1 + length('viewing arrangements.'));
        tail := btrim(substr(d, lastpos + length('viewing arrangements.')));
        core := btrim(regexp_replace(tail, '…$', ''));
        IF length(core) >= 8 AND strpos(lower(head), lower(core)) > 0 THEN
          d := head;
          steps := steps || 'caption_repeated_at_end'::TEXT;
        END IF;
      END IF;

      -- 3. A sentence of the intake's own that was cut.
      IF right(d, 1) = '…' THEN
        body := left(d, length(d) - 1);
        contact := CASE
          WHEN btrim(COALESCE(r.lister_name, '')) <> ''
            THEN 'Contact ' || btrim(r.lister_name) || ' to confirm current availability, full specifications and viewing arrangements.'
          ELSE 'Contact the listed agent to confirm current availability, full specifications and viewing arrangements.'
        END;
        m := regexp_match(body, 'Contact [^.]{1,80}? to confirm( [^.]*)?$');
        IF m IS NOT NULL THEN
          frag := COALESCE(m[1], '');
          rest := ' current availability, full specifications and viewing arrangements.';
          IF left(rest, length(frag)) = frag THEN
            d := body || substr(rest, length(frag) + 1);
            steps := steps || 'contact_sentence_completed'::TEXT;
          END IF;
        ELSE
          m := regexp_match(body, 'Watch the (?:attached video tour|\d+ attached video tours)( [^.]*)?$');
          IF m IS NOT NULL THEN
            frag := COALESCE(m[1], '');
            n := COALESCE(
              substring(frag from 'browse (\d+)')::INT,
              CASE WHEN COALESCE(r.extra_fields->>'video_key_frame_count', '') ~ '^\d{1,3}$'
                THEN (r.extra_fields->>'video_key_frame_count')::INT END,
              0
            );
            rest := CASE
              WHEN n > 0 THEN ' and browse ' || n || ' extracted key image' || CASE WHEN n = 1 THEN '' ELSE 's' END || ' before enquiring.'
              ELSE ' before enquiring.'
            END;
            IF left(rest, length(frag)) = frag THEN
              d := body || substr(rest, length(frag) + 1) || ' ' || contact;
              steps := steps || 'video_sentence_completed'::TEXT;
            END IF;
          END IF;
        END IF;
      END IF;
    ELSIF r.source LIKE 'found_online%' AND right(d, 1) = '…' THEN
      body := left(d, length(d) - 1);
      s := btrim(regexp_replace(COALESCE(r.extra_fields->>'source_title', ''), '\s+', ' ', 'g'));
      m := regexp_match(body, '^(.*The source post is titled)(?: "([^"]*))?$');
      IF s <> '' AND m IS NOT NULL AND left(s, length(COALESCE(m[2], ''))) = COALESCE(m[2], '') THEN
        d := m[1] || ' "' || s || '".';
        steps := steps || 'source_title_completed'::TEXT;
      END IF;
    END IF;

    IF d IS DISTINCT FROM before_text AND length(btrim(d)) >= 20 THEN
      UPDATE properties SET description = d, updated_at = NOW() WHERE id = r.id;
      INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, delivery)
      VALUES (
        r.id,
        'system_migration_251',
        'description_repeated_title_removed',
        'A save in King had added the title to the front of the description again, added the caption again or cut the end off.',
        'Description repaired: the extra copies taken off and a cut sentence completed. Nothing else changed.',
        jsonb_build_object('steps', to_jsonb(steps), 'description_before', before_text)
      );
    END IF;
  END LOOP;
END $$;
