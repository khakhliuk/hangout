-- Never read anywhere in the app (no "last seen", no sort, no cache
-- invalidation) — space_settings.updated_at is also never even written by
-- saveSpaceSettings, so it's permanently stale on top of being unused.
alter table profiles drop column updated_at;
alter table space_settings drop column updated_at;

-- Never written or read — resolve-place/findOrCreatePlace populate
-- google_place_id instead, maps_cid was dead from the start.
alter table places drop column maps_cid;
