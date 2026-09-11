CREATE TYPE bloom_level AS ENUM (
    'Remember',
    'Understand',
    'Apply',
    'Analyze',
    'Evaluate',
    'Create'
);

CREATE TYPE generation_job_status AS ENUM (
    'QUEUED',
    'RUNNING',
    'SUCCEEDED',
    'PARTIALLY_FAILED',
    'FAILED',
    'CANCELLED'
);

CREATE TYPE job_item_status AS ENUM (
    'QUEUED',
    'RUNNING',
    'RETRY',
    'SUCCEEDED',
    'FAILED'
);

CREATE TYPE review_decision AS ENUM ('APPROVED', 'REJECTED', 'NEEDS_EDIT');

CREATE FUNCTION set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE FUNCTION answer_choices_are_unique(
    correct_answer text,
    distractors jsonb
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
AS $$
    SELECT CASE
        WHEN jsonb_typeof(distractors) <> 'array' THEN false
        WHEN jsonb_array_length(distractors) <> 3 THEN false
        ELSE (
            SELECT count(DISTINCT lower(btrim(value))) = 3
                AND bool_and(btrim(value) <> '')
                AND bool_and(lower(btrim(value)) <> lower(btrim(correct_answer)))
            FROM jsonb_array_elements_text(distractors) AS option(value)
        )
    END;
$$;

CREATE TABLE source_documents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title text NOT NULL CHECK (btrim(title) <> ''),
    storage_uri text NOT NULL CHECK (btrim(storage_uri) <> ''),
    content_sha256 text NOT NULL UNIQUE
        CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE generation_jobs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_document_id uuid NOT NULL REFERENCES source_documents(id),
    idempotency_key text NOT NULL UNIQUE
        CHECK (length(idempotency_key) BETWEEN 8 AND 128),
    requested_count integer NOT NULL CHECK (requested_count BETWEEN 1 AND 1000),
    prompt_version text NOT NULL CHECK (btrim(prompt_version) <> ''),
    status generation_job_status NOT NULL DEFAULT 'QUEUED',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER generation_jobs_set_updated_at
BEFORE UPDATE ON generation_jobs
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE job_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_id uuid NOT NULL REFERENCES generation_jobs(id) ON DELETE CASCADE,
    ordinal integer NOT NULL CHECK (ordinal > 0),
    target_bloom bloom_level NOT NULL,
    status job_item_status NOT NULL DEFAULT 'QUEUED',
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at timestamptz NOT NULL DEFAULT now(),
    lease_owner text,
    lease_expires_at timestamptz,
    last_error text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_id, ordinal),
    CHECK (
        (status = 'RUNNING' AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
        OR
        (status <> 'RUNNING' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    )
);

CREATE TRIGGER job_items_set_updated_at
BEFORE UPDATE ON job_items
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE questions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_item_id uuid NOT NULL REFERENCES job_items(id) ON DELETE CASCADE,
    generation_version integer NOT NULL DEFAULT 1 CHECK (generation_version > 0),
    stem text NOT NULL CHECK (btrim(stem) <> ''),
    correct_answer text NOT NULL CHECK (btrim(correct_answer) <> ''),
    distractors jsonb NOT NULL,
    model_name text NOT NULL CHECK (btrim(model_name) <> ''),
    prompt_version text NOT NULL CHECK (btrim(prompt_version) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (job_item_id, generation_version),
    CHECK (answer_choices_are_unique(correct_answer, distractors))
);

CREATE TABLE automated_evaluations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    predicted_bloom bloom_level NOT NULL,
    iwf_checks jsonb NOT NULL CHECK (jsonb_typeof(iwf_checks) = 'object'),
    iwf_pass_count integer NOT NULL CHECK (iwf_pass_count BETWEEN 0 AND 19),
    evaluator_version text NOT NULL CHECK (btrim(evaluator_version) <> ''),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (question_id, evaluator_version)
);

CREATE TABLE human_reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_id uuid NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    reviewer_id text NOT NULL CHECK (btrim(reviewer_id) <> ''),
    decision review_decision NOT NULL,
    assigned_bloom bloom_level,
    notes text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (question_id, reviewer_id)
);

CREATE TRIGGER human_reviews_set_updated_at
BEFORE UPDATE ON human_reviews
FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE outbox_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    aggregate_type text NOT NULL CHECK (btrim(aggregate_type) <> ''),
    aggregate_id uuid NOT NULL,
    event_type text NOT NULL CHECK (btrim(event_type) <> ''),
    payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
    attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    published_at timestamptz
);

CREATE TABLE processed_messages (
    consumer_name text NOT NULL CHECK (btrim(consumer_name) <> ''),
    message_id text NOT NULL CHECK (btrim(message_id) <> ''),
    processed_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (consumer_name, message_id)
);

CREATE INDEX idx_generation_jobs_source_created
ON generation_jobs (source_document_id, created_at DESC);

CREATE INDEX idx_job_items_ready
ON job_items (next_attempt_at, created_at, id)
WHERE status IN ('QUEUED', 'RETRY');

COMMENT ON INDEX idx_job_items_ready IS
'Supports ordered worker claims while excluding terminal and in-flight rows.';

CREATE INDEX idx_outbox_events_unpublished
ON outbox_events (created_at, id)
WHERE published_at IS NULL;

CREATE FUNCTION claim_job_items(
    batch_size integer,
    worker_id text,
    lease_duration interval DEFAULT interval '5 minutes'
)
RETURNS SETOF job_items
LANGUAGE sql
AS $$
    WITH candidates AS (
        SELECT id
        FROM job_items
        WHERE status IN ('QUEUED', 'RETRY')
          AND next_attempt_at <= now()
        ORDER BY next_attempt_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT batch_size
    )
    UPDATE job_items AS item
    SET status = 'RUNNING',
        attempt_count = item.attempt_count + 1,
        lease_owner = worker_id,
        lease_expires_at = now() + lease_duration
    FROM candidates
    WHERE item.id = candidates.id
    RETURNING item.*;
$$;
