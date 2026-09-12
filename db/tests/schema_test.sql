BEGIN;

INSERT INTO source_documents (id, title, storage_uri, content_sha256)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Test source',
    's3://test/source.txt',
    repeat('a', 64)
);

INSERT INTO generation_jobs (
    id,
    source_document_id,
    idempotency_key,
    request_fingerprint,
    requested_count,
    prompt_version
)
VALUES (
    '00000000-0000-0000-0000-000000000002',
    '00000000-0000-0000-0000-000000000001',
    'test-job-0001',
    repeat('b', 64),
    2,
    'demo-v1'
);

INSERT INTO job_items (id, job_id, ordinal, target_bloom)
VALUES
    (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000002',
        1,
        'Remember'
    ),
    (
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000002',
        2,
        'Analyze'
    );

INSERT INTO outbox_events (
    id,
    aggregate_type,
    aggregate_id,
    event_type,
    payload
)
VALUES (
    '00000000-0000-0000-0000-000000000007',
    'job_item',
    '00000000-0000-0000-0000-000000000004',
    'generation_job_item.created',
    '{"itemId": "00000000-0000-0000-0000-000000000004"}'
);

INSERT INTO questions (
    id,
    job_item_id,
    stem,
    correct_answer,
    distractors,
    model_name,
    prompt_version
)
VALUES
    (
        '00000000-0000-0000-0000-000000000005',
        '00000000-0000-0000-0000-000000000003',
        'Which particle determines atomic number?',
        'Proton',
        '["Neutron", "Electron", "Photon"]',
        'deterministic-test-provider',
        'demo-v1'
    ),
    (
        '00000000-0000-0000-0000-000000000006',
        '00000000-0000-0000-0000-000000000004',
        'Which evidence best distinguishes the two hypotheses?',
        'The result predicted by only one hypothesis',
        '["The oldest result", "The longest result", "The most familiar result"]',
        'deterministic-test-provider',
        'demo-v1'
    );

INSERT INTO automated_evaluations (
    question_id,
    predicted_bloom,
    iwf_checks,
    iwf_pass_count,
    evaluator_version
)
VALUES
    (
        '00000000-0000-0000-0000-000000000005',
        'Remember',
        '{"unique_options": true}',
        19,
        'rules-v1'
    ),
    (
        '00000000-0000-0000-0000-000000000006',
        'Understand',
        '{"unique_options": true}',
        17,
        'rules-v1'
    );

SELECT * FROM claim_job_items(1, 'integration-test-worker');
SELECT * FROM claim_job_item(
    '00000000-0000-0000-0000-000000000004',
    'specific-worker'
);
SELECT * FROM claim_outbox_events(1, 'integration-test-publisher');

DO $$
BEGIN
    BEGIN
        INSERT INTO generation_jobs (
            source_document_id,
            idempotency_key,
            request_fingerprint,
            requested_count,
            prompt_version
        ) VALUES (
            '00000000-0000-0000-0000-000000000001',
            'invalid-count',
            repeat('d', 64),
            0,
            'demo-v1'
        );
        RAISE EXCEPTION 'requested_count constraint did not reject zero';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO generation_jobs (
            source_document_id,
            idempotency_key,
            request_fingerprint,
            requested_count,
            prompt_version
        ) VALUES (
            '00000000-0000-0000-0000-000000000001',
            'test-job-0001',
            repeat('c', 64),
            1,
            'demo-v1'
        );
        RAISE EXCEPTION 'idempotency constraint accepted a duplicate';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO questions (
            job_item_id,
            generation_version,
            stem,
            correct_answer,
            distractors,
            model_name,
            prompt_version
        ) VALUES (
            '00000000-0000-0000-0000-000000000003',
            2,
            'Invalid duplicate choices',
            'Proton',
            '["Proton", "Electron", "Photon"]',
            'deterministic-test-provider',
            'demo-v1'
        );
        RAISE EXCEPTION 'answer uniqueness constraint accepted a duplicate';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    INSERT INTO processed_messages (consumer_name, message_id)
    VALUES ('generation-worker', 'message-1');

    BEGIN
        INSERT INTO processed_messages (consumer_name, message_id)
        VALUES ('generation-worker', 'message-1');
        RAISE EXCEPTION 'message deduplication constraint accepted a duplicate';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    IF (
        SELECT count(*)
        FROM automated_evaluations
        WHERE predicted_bloom = 'Remember'
    ) <> 1 THEN
        RAISE EXCEPTION 'expected one aligned Remember evaluation';
    END IF;

    IF (
        SELECT count(*)
        FROM job_items
        WHERE status = 'RUNNING'
          AND lease_owner = 'integration-test-worker'
          AND lease_expires_at IS NOT NULL
          AND attempt_count = 1
    ) <> 1 THEN
        RAISE EXCEPTION 'claim query did not lease exactly one ready item';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_index
        JOIN pg_class AS index_relation
          ON index_relation.oid = pg_index.indexrelid
        WHERE index_relation.relname = 'idx_job_items_ready'
          AND pg_index.indpred IS NOT NULL
    ) THEN
        RAISE EXCEPTION 'worker-ready partial index is missing or not partial';
    END IF;

    IF (
        SELECT count(*)
        FROM job_items
        WHERE id = '00000000-0000-0000-0000-000000000004'
          AND status = 'RUNNING'
          AND lease_owner = 'specific-worker'
          AND attempt_count = 1
    ) <> 1 THEN
        RAISE EXCEPTION 'specific item claim did not record the worker lease';
    END IF;

    IF (
        SELECT count(*)
        FROM outbox_events
        WHERE id = '00000000-0000-0000-0000-000000000007'
          AND lease_owner = 'integration-test-publisher'
          AND lease_expires_at IS NOT NULL
          AND attempt_count = 1
    ) <> 1 THEN
        RAISE EXCEPTION 'outbox claim did not record the publisher lease';
    END IF;
END;
$$;

\ir ../queries/bloom_quality_summary.sql

ROLLBACK;
