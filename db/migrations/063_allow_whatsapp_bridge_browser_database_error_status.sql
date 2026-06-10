ALTER TABLE whatsapp_web_bridge_clients
  DROP CONSTRAINT IF EXISTS whatsapp_web_bridge_clients_status_check;

ALTER TABLE whatsapp_web_bridge_clients
  ADD CONSTRAINT whatsapp_web_bridge_clients_status_check
  CHECK (status IN (
    'offline',
    'starting',
    'waiting_for_login',
    'open_elsewhere',
    'browser_database_error',
    'online',
    'degraded',
    'error'
  ));
