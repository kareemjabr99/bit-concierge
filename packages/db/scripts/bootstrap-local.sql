-- Local development only. Never run against a managed database.
--
-- Migrations create bitc_app and bitc_migrator as NOLOGIN group roles, which is
-- the shape a managed provider expects. Locally we need something that can
-- actually connect, so we add login users that are members of those groups.
CREATE USER bitc_app_local WITH PASSWORD 'localdev';
GRANT bitc_app TO bitc_app_local;
