-- Which storefront origins may call the chat endpoint for this tenant.
--
-- The widget key is printed in the page source: it identifies a tenant and
-- authorises nothing. Anyone who views source can lift it and embed the widget
-- on their own site, where it would answer as this store and spend this
-- store's model quota.
--
-- An Origin header is not a security boundary on its own — a non-browser
-- caller simply omits it, and the endpoint allows that, because the endpoint
-- is public anyway and rate limiting is the real control. What this stops is
-- the cheap case: a browser embedding the widget on another domain.
--
-- Default empty, which allows no browser origin at all. A tenant that has not
-- registered its storefront gets a widget that works from curl and not from a
-- page, which is a visible failure rather than a quiet permissive one.

-- Origins are scheme + host [+ port] and nothing else, because that is exactly
-- what a browser puts in the header. A trailing slash or a path here matches
-- nothing, silently, for ever — so it is rejected at write time instead.
--
-- A function rather than an inline CHECK: validating each element needs
-- unnest, and Postgres does not allow a subquery in a constraint expression.
CREATE OR REPLACE FUNCTION bitc_origins_well_formed(origins text[])
RETURNS boolean
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  -- bool_and over an empty array is NULL, and an empty list is valid.
  SELECT bool_and(origin ~ '^https?://[^/?#[:space:]]+$') IS NOT FALSE
  FROM unnest(origins) AS origin;
$$;

ALTER TABLE tenant_config
  ADD COLUMN widget_origins text[] NOT NULL DEFAULT '{}';

ALTER TABLE tenant_config
  ADD CONSTRAINT tenant_config_widget_origins_check
  CHECK (bitc_origins_well_formed(widget_origins));
