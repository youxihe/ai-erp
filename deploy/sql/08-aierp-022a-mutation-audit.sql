-- AIERP-022A: append-only mutation audit + versioned immutable PDF receipt storage.
-- Idempotent: safe to re-run. Does not alter native ERP stock tables.
-- PDF bytes/sha are never overwritten; layout upgrades insert a new version row + new file.

-- 1) Optional current layout pointer on receipt (backward compatible)
SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_gateway_receipt'
    AND COLUMN_NAME = 'pdf_layout_version'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_gateway_receipt ADD COLUMN pdf_layout_version INT NOT NULL DEFAULT 1 AFTER pdf_status',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col_exists := (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'aierp_gateway_receipt'
    AND COLUMN_NAME = 'receipt_kind'
);
SET @sql := IF(@col_exists = 0,
  'ALTER TABLE aierp_gateway_receipt ADD COLUMN receipt_kind VARCHAR(32) NULL AFTER bill_number',
  'SELECT 1');
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2) Immutable PDF version history (append-only; never UPDATE sha/path of an existing row)
CREATE TABLE IF NOT EXISTS aierp_gateway_receipt_pdf_version (
  id BIGINT NOT NULL AUTO_INCREMENT,
  receipt_id CHAR(32) NOT NULL,
  layout_version INT NOT NULL,
  pdf_sha256 CHAR(64) NOT NULL,
  pdf_storage_ref VARCHAR(512) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  byte_length BIGINT NOT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_receipt_layout (receipt_id, layout_version),
  KEY idx_aierp_receipt_pdf_ver (receipt_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Append-only mutation audit events (reusable by partner/material/batch later)
CREATE TABLE IF NOT EXISTS aierp_gateway_audit_event (
  id BIGINT NOT NULL AUTO_INCREMENT,
  event_id CHAR(32) NOT NULL,
  tenant_id BIGINT NOT NULL,
  actor_user_id BIGINT DEFAULT NULL,
  bot_id VARCHAR(128) DEFAULT NULL,
  wecom_user_id VARCHAR(128) DEFAULT NULL,
  binding_id BIGINT DEFAULT NULL,
  binding_version BIGINT DEFAULT NULL,
  trace_id VARCHAR(64) DEFAULT NULL,
  message_msg_id VARCHAR(128) DEFAULT NULL,
  action VARCHAR(64) NOT NULL COMMENT 'PURCHASE_IN|MIX|SERVICE_CONSUME|PARTNER_CREATE|PARTNER_UPDATE|MATERIAL_CREATE|MATERIAL_UPDATE|DRAFT_CANCEL|BATCH_PURCHASE|PDF_LAYOUT|...',
  status VARCHAR(32) NOT NULL COMMENT 'COMMITTED|POSTED|FAILED|REJECTED|REPLAY_NOOP|PDF_GENERATED|PDF_FAILED|...',
  natural_key VARCHAR(128) DEFAULT NULL,
  native_bill VARCHAR(64) DEFAULT NULL,
  draft_id BIGINT DEFAULT NULL,
  receipt_id CHAR(32) DEFAULT NULL,
  canonical_hash CHAR(64) DEFAULT NULL,
  before_json MEDIUMTEXT,
  after_json MEDIUMTEXT,
  detail_json MEDIUMTEXT COMMENT 'non-sensitive structured detail only; no raw secrets',
  pdf_layout_version INT DEFAULT NULL,
  pdf_sha256 CHAR(64) DEFAULT NULL,
  delivery_status VARCHAR(32) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_audit_event_id (event_id),
  KEY idx_aierp_audit_tenant_time (tenant_id, created_at),
  KEY idx_aierp_audit_bill (tenant_id, native_bill),
  KEY idx_aierp_audit_action (tenant_id, action, created_at),
  KEY idx_aierp_audit_receipt (receipt_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
