-- AIERP-012A: WeCom identity ↔ ERP user binding (read-only stock path)
-- Binding codes store SHA-256 hashes only; never store plaintext codes or ERP passwords.

CREATE TABLE IF NOT EXISTS aierp_wecom_bind_code (
  id BIGINT NOT NULL AUTO_INCREMENT,
  code_hash CHAR(64) NOT NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'wecom',
  bot_id VARCHAR(128) NOT NULL,
  wecom_user_id VARCHAR(128) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_wecom_code_hash (code_hash),
  KEY idx_aierp_wecom_code_user (wecom_user_id, status),
  KEY idx_aierp_wecom_code_exp (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aierp_wecom_binding (
  id BIGINT NOT NULL AUTO_INCREMENT,
  channel VARCHAR(32) NOT NULL DEFAULT 'wecom',
  bot_id VARCHAR(128) NOT NULL,
  wecom_user_id VARCHAR(128) NOT NULL,
  tenant_id BIGINT NOT NULL,
  erp_user_id BIGINT NOT NULL,
  erp_login_name VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
  bound_at DATETIME NOT NULL,
  unbound_at DATETIME DEFAULT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_wecom_identity (channel, bot_id, wecom_user_id),
  KEY idx_aierp_wecom_erp (tenant_id, erp_user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
