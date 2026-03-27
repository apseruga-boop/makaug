CREATE TABLE IF NOT EXISTS ai_model_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'api',
  input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  output_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_name TEXT,
  language TEXT,
  quality_score NUMERIC(4,3),
  error_message TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS ai_model_feedback (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID REFERENCES ai_model_events(id) ON DELETE SET NULL,
  rating INTEGER CHECK (rating BETWEEN 1 AND 5),
  label TEXT,
  notes TEXT,
  actor_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_model_events_event_type_created
  ON ai_model_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_model_events_source_created
  ON ai_model_events(source, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_model_events_language_created
  ON ai_model_events(language, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_model_feedback_event
  ON ai_model_feedback(event_id, created_at DESC);
