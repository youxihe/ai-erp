-- AIERP-002 Excel preview and receipt store. Not an inventory table.
CREATE TABLE IF NOT EXISTS aierp_excel_preview (
  id BIGINT NOT NULL AUTO_INCREMENT,
  preview_key VARCHAR(64) NOT NULL,
  tenant_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  file_name VARCHAR(255) DEFAULT NULL,
  payload_json MEDIUMTEXT NOT NULL,
  create_time DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_excel_preview (preview_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS aierp_excel_batch (
  id BIGINT NOT NULL AUTO_INCREMENT,
  batch_key VARCHAR(80) NOT NULL,
  preview_key VARCHAR(64) NOT NULL,
  tenant_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  result_json MEDIUMTEXT NOT NULL,
  create_time DATETIME NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_aierp_excel_batch (tenant_id, user_id, batch_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
