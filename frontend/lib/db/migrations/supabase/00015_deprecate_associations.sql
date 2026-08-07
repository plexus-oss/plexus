-- source_associations table is deprecated.
-- Data relationships are now expressed via dashboard variables + schema-aware queries.
-- Table is kept for backward compatibility but no longer written to by the application.
-- Safe to DROP in a future migration once confirmed no data dependencies exist.
COMMENT ON TABLE source_associations IS 'DEPRECATED: Use dashboard variables and schema explorer instead. No longer written to by the application.';
