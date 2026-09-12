ALTER TABLE outbox_events
ADD COLUMN lease_owner text,
ADD COLUMN lease_expires_at timestamptz;

ALTER TABLE outbox_events
ADD CONSTRAINT outbox_events_lease_pair
CHECK (
    (lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
);

CREATE FUNCTION claim_outbox_events(
    batch_size integer,
    publisher_id text,
    lease_duration interval DEFAULT interval '1 minute'
)
RETURNS SETOF outbox_events
LANGUAGE sql
AS $$
    WITH candidates AS (
        SELECT id
        FROM outbox_events
        WHERE published_at IS NULL
          AND (lease_expires_at IS NULL OR lease_expires_at <= now())
        ORDER BY created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT batch_size
    )
    UPDATE outbox_events AS event
    SET attempt_count = event.attempt_count + 1,
        lease_owner = publisher_id,
        lease_expires_at = now() + lease_duration
    FROM candidates
    WHERE event.id = candidates.id
    RETURNING event.*;
$$;

CREATE FUNCTION claim_job_item(
    work_item_id uuid,
    worker_id text,
    lease_duration interval DEFAULT interval '5 minutes'
)
RETURNS SETOF job_items
LANGUAGE sql
AS $$
    WITH candidate AS (
        SELECT id
        FROM job_items
        WHERE id = work_item_id
          AND (
              (
                  status IN ('QUEUED', 'RETRY')
                  AND next_attempt_at <= now()
              )
              OR
              (
                  status = 'RUNNING'
                  AND lease_expires_at <= now()
              )
          )
        FOR UPDATE SKIP LOCKED
    )
    UPDATE job_items AS item
    SET status = 'RUNNING',
        attempt_count = item.attempt_count + 1,
        lease_owner = worker_id,
        lease_expires_at = now() + lease_duration,
        last_error = NULL
    FROM candidate
    WHERE item.id = candidate.id
    RETURNING item.*;
$$;

CREATE FUNCTION refresh_generation_job_status(target_job_id uuid)
RETURNS generation_job_status
LANGUAGE plpgsql
AS $$
DECLARE
    next_status generation_job_status;
BEGIN
    SELECT CASE
        WHEN bool_or(status = 'RUNNING') THEN 'RUNNING'::generation_job_status
        WHEN bool_or(status IN ('QUEUED', 'RETRY'))
            AND bool_or(status = 'SUCCEEDED') THEN 'RUNNING'::generation_job_status
        WHEN bool_or(status IN ('QUEUED', 'RETRY')) THEN 'QUEUED'::generation_job_status
        WHEN bool_or(status = 'FAILED')
            AND bool_or(status = 'SUCCEEDED') THEN 'PARTIALLY_FAILED'::generation_job_status
        WHEN bool_or(status = 'FAILED') THEN 'FAILED'::generation_job_status
        ELSE 'SUCCEEDED'::generation_job_status
    END
    INTO next_status
    FROM job_items
    WHERE job_id = target_job_id;

    UPDATE generation_jobs
    SET status = next_status
    WHERE id = target_job_id;

    RETURN next_status;
END;
$$;

COMMENT ON FUNCTION claim_outbox_events(integer, text, interval) IS
'Leases unpublished events so a crashed publisher can be safely retried after lease expiration.';

COMMENT ON FUNCTION claim_job_item(uuid, text, interval) IS
'Atomically claims a queued/retry item or reclaims an expired running lease for an SQS worker.';
