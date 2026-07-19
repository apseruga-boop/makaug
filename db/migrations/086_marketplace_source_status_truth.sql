BEGIN;

ALTER TABLE marketplace_source_registry
  DROP CONSTRAINT IF EXISTS marketplace_source_registry_adapter_status_check;

ALTER TABLE marketplace_source_registry
  ADD CONSTRAINT marketplace_source_registry_adapter_status_check
  CHECK (adapter_status IN (
    'active',
    'configured',
    'requires_configuration',
    'enrichment_only',
    'unavailable',
    'paused'
  ));

COMMIT;
