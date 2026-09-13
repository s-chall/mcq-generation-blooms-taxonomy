ALTER TABLE generation_jobs
ADD COLUMN request_fingerprint text;

UPDATE generation_jobs
SET request_fingerprint = 'legacy:' || idempotency_key;

ALTER TABLE generation_jobs
ALTER COLUMN request_fingerprint SET NOT NULL;

ALTER TABLE generation_jobs
ADD CONSTRAINT generation_jobs_request_fingerprint_not_blank
CHECK (btrim(request_fingerprint) <> '');

COMMENT ON COLUMN generation_jobs.request_fingerprint IS
'SHA-256 of the normalized job request. A reused idempotency key is valid only when this value matches.';
