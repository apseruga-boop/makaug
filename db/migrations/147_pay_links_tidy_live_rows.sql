-- Two things wrong with the pay links already in the wild (7 Oct 2026)
--
-- 1. An exempt agent's link carried "— voluntary, stays fee-exempt" in its
--    description, and the description is public: it is printed on the /pay
--    page the agent opens and read back in the payment message. So an agent
--    paying us a favour was handed an invoice explaining that he did not have
--    to. The code no longer writes it; this strips it from the rows that
--    already have it, because one of those pages is live right now.
--
-- 2. Every link was born already "opened". pageData stamps opened_at, and the
--    code that composes the WhatsApp message called pageData to find out which
--    payment methods to promise — so opened_at was set before the message had
--    even been sent. On the live rows it lands milliseconds before sent_at,
--    which no human can do.
--
--    That stamp is the difference between "they have seen the bill and are
--    ignoring it" and "it never reached them" — the two halves of the chase
--    list. It was worthless on every link we have. Clearing it where it cannot
--    have been a person restores the signal: a ten-second window is far longer
--    than the gap our own code produced (milliseconds to two seconds) and far
--    shorter than anyone could receive a WhatsApp, read it and tap a link.

SET LOCAL lock_timeout = '8s';
SET LOCAL statement_timeout = '90s';

UPDATE pay_links
   SET description = regexp_replace(description, '\s*—\s*voluntary, stays fee-exempt\s*$', ''),
       updated_at = NOW()
 WHERE description LIKE '%voluntary, stays fee-exempt%';

UPDATE pay_links
   SET opened_at = NULL,
       updated_at = NOW()
 WHERE opened_at IS NOT NULL
   AND opened_at < created_at + INTERVAL '10 seconds';
