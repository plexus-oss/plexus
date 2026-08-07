-- Add query_template to source_associations
-- Allows associations to store parameterized SQL queries (with JOINs)
-- instead of simple single-table SELECT with filter_column/filter_value.
-- Placeholders: {{entity_id}}, {{start_time}}, {{end_time}}
ALTER TABLE source_associations ADD COLUMN query_template TEXT;
