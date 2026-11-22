-- 22 Nov 2026, 21:10 Kampala: migration 251 repaired the descriptions that
-- King's review save had doubled, but one of its rules also matched
-- descriptions that were never broken. A WhatsApp intake description opens
-- with its own lead ("Land for sale in Kissasi, Kampala, listed at UGX
-- 900,000,000.") and then the agent's caption, and the listing's title is
-- often the caption's first words ("64 Decimals in kissasi malcom"). 251 read
-- that lead and title as copies the save had added, took them off, and the
-- listing opened "SELLING 900M Kampala."
--
-- 251 kept every description it changed (description_before in its event).
-- This starts again from that text for each listing 251 changed and nobody on
-- the team has changed since, and repairs it with the rule narrowed: a lead
-- sentence comes off only when it has no comma in it (the intake's own lead
-- has the district and the price after commas), and on an intake description
-- only when what follows the title is the title again, the lead again, or the
-- intake's own lead. Every other step is 251's. Listings 251 had right come
-- out the same and are not written again. The text 251 left is kept in the
-- event, and nobody is sent anything.
DO $$
DECLARE
  r RECORD;
  t TEXT;
  tl TEXT;
  d TEXT;
  prev TEXT;
  x TEXT;
  after_title TEXT;
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
    SELECT p.id, p.title, p.description, p.source, p.lister_name, p.extra_fields,
           e.delivery->>'description_before' AS before_251
      FROM property_moderation_events e
      JOIN properties p ON p.id = e.property_id
     WHERE e.actor_id = 'system_migration_251'
       AND e.action = 'description_repeated_title_removed'
       AND length(btrim(COALESCE(e.delivery->>'description_before', ''))) >= 20
       AND length(btrim(COALESCE(p.title, ''))) >= 8
       -- Nobody on the team has touched the listing since (their ids are uuids).
       AND NOT EXISTS (
         SELECT 1 FROM property_moderation_events x
          WHERE x.property_id = p.id
            AND x.created_at > e.created_at
            AND COALESCE(x.actor_id, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-'
       )
  LOOP
    t := btrim(r.title);
    tl := lower(t);
    d := r.before_251;
    steps := ARRAY[]::TEXT[];

    -- 1. The front.
    FOR i IN 1..12 LOOP
      prev := d;
      IF lower(left(d, 2 * length(t) + 1)) = tl || ' ' || tl THEN
        d := substr(d, length(t) + 2);
        steps := steps || 'title_repeated'::TEXT;
      ELSE
        x := substring(d from '^([^.]{3,90})\. ');
        after_title := CASE WHEN x IS NULL THEN NULL ELSE substr(d, length(x) + length(t) + 4) END;
        IF x IS NOT NULL
           AND x ~* '^(?:\d+-bed )?[a-z][a-z -]{1,40} (?:for sale|for rent|to let|to rent|for lease) in [^.,]{2,60}$'
           AND lower(substr(d, length(x) + 3, length(t) + 1)) = tl || ' '
           AND substr(after_title, 1, 1) ~ '[A-Z0-9]'
           AND (
             -- Only an intake description opens with a lead and then a caption
             -- that can start with the title's words.
             COALESCE(r.source, '') <> 'whatsapp_employee_intake'
             OR lower(after_title) LIKE tl || '%'
             OR lower(after_title) LIKE lower(x) || '%'
             OR after_title ~ '^(?:Property for sale|Rental property|Land for sale|Commercial property|Student accommodation|Property listing)(?: in |, |\. )'
           ) THEN
          d := after_title;
          steps := steps || 'lead_and_title'::TEXT;
        ELSE
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

    IF length(btrim(d)) < 20 THEN
      d := r.before_251;
      steps := ARRAY['kept_as_before']::TEXT[];
    END IF;

    IF d IS DISTINCT FROM r.description THEN
      UPDATE properties SET description = d, updated_at = NOW() WHERE id = r.id;
      INSERT INTO property_moderation_events (property_id, actor_id, action, reason, notes, delivery)
      VALUES (
        r.id,
        'system_migration_252',
        'description_repair_corrected',
        'Migration 251 had taken words off a description that was not broken.',
        'Description put back as it was before 251, then repaired with the narrowed rule. Nothing else changed.',
        jsonb_build_object('steps', to_jsonb(steps), 'description_before', r.description, 'description_before_251', r.before_251)
      );
    END IF;
  END LOOP;
END $$;
