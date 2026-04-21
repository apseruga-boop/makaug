-- Remove practical listing caps for brokers/agents.
-- Keep column for backward compatibility, but set to a very high value.

UPDATE agents
SET listing_limit = 2147483647
WHERE listing_limit IS NULL OR listing_limit < 2147483647;

