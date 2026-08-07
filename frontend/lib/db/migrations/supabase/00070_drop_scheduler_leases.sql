-- Remove the leader-election lease feature (added in 00066).
--
-- It was defense-in-depth for scaling the offline detector past one Fly machine,
-- but the deploy is single-always-on and the detector's own findOpenByRuleAndSource
-- check already prevents duplicate alerts. The table also caused a hard failure in
-- prod: a pre-existing scheduler_leases table meant 00066's CREATE TABLE IF NOT
-- EXISTS was a no-op, so locked_until never existed and every tick logged
-- "column scheduler_leases.locked_until does not exist". Drop it for good.

DROP TABLE IF EXISTS scheduler_leases;
