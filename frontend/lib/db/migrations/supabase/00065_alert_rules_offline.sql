-- Add the 'offline' alert rule type: "stream stopped" detection.
--
-- Offline rules are absence-detection — a source that stops sending. They're
-- evaluated by the frontend's in-process detectOfflineOnce() loop (a stream
-- consumer like the alert-service can't detect silence), and carry no metric /
-- operator / sub_rules; the timeout lives in conditions.timeout_seconds.

-- 1. Extend the enum. (Cannot be *used* later in this same transaction, so the
--    shape constraint below avoids naming the 'offline' literal.)
ALTER TYPE alert_rule_type ADD VALUE IF NOT EXISTS 'offline';

-- 2. Relax the shape constraint so offline rows (metric/operator/sub_rules all
--    NULL) are valid. The third branch matches offline without referencing the
--    new enum value directly.
ALTER TABLE alert_rules DROP CONSTRAINT IF EXISTS alert_rules_type_shape;
ALTER TABLE alert_rules ADD CONSTRAINT alert_rules_type_shape CHECK (
    (type = 'compound'   AND metric IS NULL      AND operator IS NOT NULL AND sub_rules IS NOT NULL)
    OR
    (type IN ('threshold','outlier') AND metric IS NOT NULL AND operator IS NULL AND sub_rules IS NULL)
    OR
    (metric IS NULL AND operator IS NULL AND sub_rules IS NULL)
);
