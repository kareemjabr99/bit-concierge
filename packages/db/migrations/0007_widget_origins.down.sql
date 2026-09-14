ALTER TABLE tenant_config DROP CONSTRAINT tenant_config_widget_origins_check;
ALTER TABLE tenant_config DROP COLUMN widget_origins;
DROP FUNCTION IF EXISTS bitc_origins_well_formed(text[]);
