-- AIERP-021B: WeCom material master-data prepare/commit requests.
-- Prepare writes only this table; jsh_material / jsh_material_extend touched on trusted commit.
-- Never writes jsh_material_current_stock / jsh_material_initial_stock / depot_head.

CREATE TABLE IF NOT EXISTS aierp_master_material_request (
  id BIGINT NOT NULL AUTO_INCREMENT,
  challenge_id CHAR(32) NOT NULL,
  channel VARCHAR(32) NOT NULL DEFAULT 'wecom',
  bot_id VARCHAR(128) NOT NULL,
  wecom_user_id VARCHAR(128) NOT NULL,
  tenant_id BIGINT NOT NULL,
  erp_user_id BIGINT NOT NULL,
  binding_id BIGINT NOT NULL,
  binding_version BIGINT NOT NULL,
  op_type VARCHAR(16) NOT NULL,
  material_id BIGINT DEFAULT NULL,
  bar_code VARCHAR(64) DEFAULT NULL,
  record_digest CHAR(64) DEFAULT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  expected_phrase VARCHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  result_material_id BIGINT DEFAULT NULL,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME DEFAULT NULL,
  consume_message_id VARCHAR(128) DEFAULT NULL,
  created_at DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_material_challenge (challenge_id),
  KEY idx_aierp_material_owner (channel, bot_id, wecom_user_id, status),
  KEY idx_aierp_material_msgid (consume_message_id),
  KEY idx_aierp_material_tenant (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
