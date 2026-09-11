SELECT
    item.target_bloom,
    count(*) AS evaluated_questions,
    count(*) FILTER (
        WHERE evaluation.predicted_bloom = item.target_bloom
    ) AS aligned_questions,
    round(
        100.0 * count(*) FILTER (
            WHERE evaluation.predicted_bloom = item.target_bloom
        ) / NULLIF(count(*), 0),
        2
    ) AS alignment_percent,
    round(avg(evaluation.iwf_pass_count), 2) AS average_iwf_pass_count
FROM job_items AS item
JOIN questions AS question ON question.job_item_id = item.id
JOIN automated_evaluations AS evaluation
    ON evaluation.question_id = question.id
GROUP BY item.target_bloom
ORDER BY item.target_bloom;
