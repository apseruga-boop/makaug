-- The name an agent is greeted by (2 Oct 2026)
--
-- Ugandan names are often stored surname first: "Agaba Amos", "Kimuli Brian".
-- Every WhatsApp message took the first word, so Amos was "Hi Amos" in the
-- broadcast (chosen by hand) and then "Hello Agaba!" from the bot a minute
-- later. greeting_name is the one name every agent-facing message uses; when
-- empty, the first word of full_name is still the fallback.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE agents ADD COLUMN IF NOT EXISTS greeting_name TEXT;

-- The names the agents were greeted by in the 2 Oct how-to-post broadcast.
UPDATE agents AS a
   SET greeting_name = v.greeting_name
  FROM (VALUES
    ('752509630', 'Frederick'),
    ('701452248', 'Jonathan'),
    ('750925959', 'Quickway'),
    ('702350417', 'Sharif'),
    ('708020927', 'Innocent'),
    ('774505232', 'Brian'),
    ('701895892', 'Bonny'),
    ('751182011', 'Promise'),
    ('768524008', 'Francis'),
    ('786413703', 'Amos'),
    ('791218405', 'Kazi')
  ) AS v(phone_key, greeting_name)
 WHERE a.greeting_name IS NULL
   AND (
     RIGHT(REGEXP_REPLACE(COALESCE(a.whatsapp, ''), '[^0-9]', '', 'g'), 9) = v.phone_key
     OR RIGHT(REGEXP_REPLACE(COALESCE(a.phone, ''), '[^0-9]', '', 'g'), 9) = v.phone_key
   );
