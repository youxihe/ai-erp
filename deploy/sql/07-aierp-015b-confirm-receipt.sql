-- AIERP-015B: binding generation, confirm challenge, business receipt.
-- Idempotent: safe to re-run (checks information_schema / IF NOT EXISTS).

-- 1) Monotonic binding generation (same-second rebind must not reuse old drafts)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_wecom_binding'
    AND COLUMN_NAME = 'binding_version'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_wecom_binding ADD COLUMN binding_version BIGINT NOT NULL DEFAULT 1 AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE aierp_wecom_binding
SET binding_version = GREATEST(IFNULL(binding_version, 0), 1)
WHERE binding_version IS NULL OR binding_version < 1;

-- 2) Draft stores binding_version (preferred over second-precision bound_at)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_gateway_draft'
    AND COLUMN_NAME = 'binding_version'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_gateway_draft ADD COLUMN binding_version BIGINT NULL AFTER binding_bound_at',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_gateway_draft'
    AND COLUMN_NAME = 'payload_hash'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_gateway_draft ADD COLUMN payload_hash CHAR(64) NULL AFTER payload_json',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_gateway_draft'
    AND COLUMN_NAME = 'draft_version'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_gateway_draft ADD COLUMN draft_version INT NOT NULL DEFAULT 1 AFTER status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Backfill payload_hash / binding_version where possible (best-effort)
UPDATE aierp_gateway_draft d
INNER JOIN aierp_wecom_binding b ON b.id = d.binding_id
SET d.binding_version = b.binding_version
WHERE d.binding_id IS NOT NULL AND d.binding_version IS NULL;

-- 3) One-time confirm challenge (server-side; phrase shown to user is draft-scoped)
CREATE TABLE IF NOT EXISTS aierp_gateway_confirm_challenge (
  id BIGINT NOT NULL AUTO_INCREMENT,
  challenge_id CHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'wecom',
  bot_id VARCHAR(128) NOT NULL,
  wecom_user_id VARCHAR(128) NOT NULL,
  tenant_id BIGINT NOT NULL,
  erp_user_id BIGINT NOT NULL,
  binding_id BIGINT NOT NULL,
  binding_version BIGINT NOT NULL,
  draft_id BIGINT NOT NULL,
  draft_version INT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  expected_phrase VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  consume_message_id VARCHAR(128) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_challenge_id (challenge_id),
  KEY idx_aierp_challenge_draft (draft_id, status),
  KEY idx_aierp_challenge_owner (channel, bot_id, wecom_user_id, status),
  KEY idx_aierp_challenge_msgid (consume_message_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Business receipt (not an invoice); PDF optional
CREATE TABLE IF NOT EXISTS aierp_gateway_receipt (
  id BIGINT NOT NULL AUTO_INCREMENT,
  receipt_id CHAR(32) NOT NULL,
  tenant_id BIGINT NOT NULL,
  actor_user_id BIGINT NOT NULL,
  draft_id BIGINT NOT NULL,
  bill_number VARCHAR(64) NOT NULL,
  depot_head_id BIGINT NOT NULL,
  binding_version BIGINT DEFAULT NULL,
  wecom_user_id VARCHAR(128) DEFAULT NULL,
  receipt_json MEDIUMTEXT NOT NULL,
  text_body MEDIUMTEXT NOT NULL,
  pdf_sha256 CHAR(64) DEFAULT NULL,
  pdf_storage_ref VARCHAR(512) DEFAULT NULL,
  pdf_status VARCHAR(32) NOT NULL DEFAULT 'NONE',
  delivery_status VARCHAR(32) NOT NULL DEFAULT 'TEXT_ONLY',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_receipt_id (receipt_id),
  UNIQUE KEY uk_aierp_receipt_bill (tenant_id, bill_number),
  KEY idx_aierp_receipt_draft (draft_id),
  KEY idx_aierp_receipt_actor (tenant_id, actor_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
