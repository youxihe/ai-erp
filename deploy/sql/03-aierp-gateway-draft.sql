-- AIERP-003 draft store. Not an inventory table.
-- Official stock changes only happen when draft.confirm calls native depotHead services.
CREATE TABLE IF NOT EXISTS aierp_gateway_draft (
  id BIGINT NOT NULL AUTO_INCREMENT,
  idempotency_key VARCHAR(80) NOT NULL,
  tenant_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  biz_type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  bill_number VARCHAR(64) DEFAULT NULL,
  depot_head_id BIGINT DEFAULT NULL,
  create_time DATETIME NOT NULL,
  confirm_time DATETIME DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_draft_user_key (tenant_id, user_id, idempotency_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Serializes gateway stock checks for the same tenant, depot and material.
-- Native ERP screens that post bills outside this gateway are not covered.
CREATE TABLE IF NOT EXISTS aierp_stock_guard (
  tenant_id BIGINT NOT NULL,
  depot_id BIGINT NOT NULL,
  material_id BIGINT NOT NULL,
  PRIMARY KEY (tenant_id, depot_id, material_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
