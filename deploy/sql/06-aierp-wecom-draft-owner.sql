-- AIERP-015A Review Fix: WeCom channel ownership on gateway drafts.
-- Legacy ERP-session drafts keep these columns NULL and are not accessible via WeCom status/cancel.

ALTER TABLE aierp_gateway_draft
  ADD COLUMN channel VARCHAR(32) NULL AFTER user_id,
  ADD COLUMN bot_id VARCHAR(128) NULL AFTER channel,
  ADD COLUMN wecom_user_id VARCHAR(128) NULL AFTER bot_id,
  ADD COLUMN binding_id BIGINT NULL AFTER wecom_user_id,
  ADD COLUMN binding_bound_at DATETIME NULL AFTER binding_id;

CREATE INDEX idx_aierp_draft_wecom ON aierp_gateway_draft (channel, bot_id, wecom_user_id, status);
