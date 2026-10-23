-- Generated agent bios are computed when a profile is read. They are not
-- stored in agents.bio (migration 149). The generator used to end the first
-- sentence with "with 5 live listings on makaug". That number goes stale as
-- soon as a listing is added or removed, so the sentence no longer states a
-- count.
--
-- If that generated sentence was saved into agents.bio anyway, clear it and
-- let the profile use the new generator. Agent-written bios do not match
-- this pattern and stay as written. A second run matches nothing, so the
-- updated_at trigger does not rewrite a row again.

UPDATE agents
   SET bio = NULL
 WHERE bio IS NOT NULL
   AND bio ~* '(^|[[:space:]])specialises in .+ with [0-9]+ live listings? on makaug';
