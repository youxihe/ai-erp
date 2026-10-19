-- AI-ERP PCB demo master data (tenant_id=63 / login jsh)
-- Idempotent by business codes. Does NOT write stock balances.
-- Stock must come from native depotHead bills (purchase / assemble / other-out).

SET NAMES utf8mb4;

-- Local POC: force approval so audit visibly changes stock.
UPDATE jsh_system_config
SET force_approval_flag = '1'
WHERE tenant_id = 63 AND IFNULL(delete_flag, '0') != '1';

-- Captcha off for automated API checks (re-enable in UI if needed).
UPDATE jsh_platform_config
SET platform_value = '0'
WHERE platform_key = 'checkcode_flag';

-- Depots (reuse native ids 14/15 if present; rename for PCB scene)
UPDATE jsh_depot SET name = '原料仓', remark = 'PCB原料仓', enabled = b'1', is_default = b'1'
WHERE id = 14 AND tenant_id = 63;
UPDATE jsh_depot SET name = '成品仓', remark = 'PCB成品/药水仓', enabled = b'1', is_default = b'0'
WHERE id = 15 AND tenant_id = 63;

-- Suppliers / customers
INSERT INTO jsh_supplier (
  id, supplier, contacts, phone_num, email, description, isystem, type, enabled,
  advance_in, begin_need_get, begin_need_pay, all_need_get, all_need_pay,
  fax, telephone, address, tax_num, bank_name, account_number, tax_rate, sort,
  creator, tenant_id, delete_flag
)
SELECT 901, '华东化工', '张工', '13800000001', NULL, 'PCB原料供应商-演示', 0, '供应商', b'1',
       0, 0, 0, 0, 0, NULL, NULL, '上海', NULL, NULL, NULL, NULL, '1', 63, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_supplier WHERE id = 901 OR (supplier = '华东化工' AND tenant_id = 63));

INSERT INTO jsh_supplier (
  id, supplier, contacts, phone_num, email, description, isystem, type, enabled,
  advance_in, begin_need_get, begin_need_pay, all_need_get, all_need_pay,
  fax, telephone, address, tax_num, bank_name, account_number, tax_rate, sort,
  creator, tenant_id, delete_flag
)
SELECT 902, '华南助剂', '李工', '13800000002', NULL, 'PCB原料供应商-演示', 0, '供应商', b'1',
       0, 0, 0, 0, 0, NULL, NULL, '深圳', NULL, NULL, NULL, NULL, '2', 63, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_supplier WHERE id = 902 OR (supplier = '华南助剂' AND tenant_id = 63));

INSERT INTO jsh_supplier (
  id, supplier, contacts, phone_num, email, description, isystem, type, enabled,
  advance_in, begin_need_get, begin_need_pay, all_need_get, all_need_pay,
  fax, telephone, address, tax_num, bank_name, account_number, tax_rate, sort,
  creator, tenant_id, delete_flag
)
SELECT 911, '苏州精密电子', '王工', '13900000001', NULL, 'PCB清洗服务客户-演示', 0, '客户', b'1',
       0, 0, 0, 0, 0, NULL, NULL, '苏州', NULL, NULL, NULL, NULL, '1', 63, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_supplier WHERE id = 911 OR (supplier = '苏州精密电子' AND tenant_id = 63));

INSERT INTO jsh_supplier (
  id, supplier, contacts, phone_num, email, description, isystem, type, enabled,
  advance_in, begin_need_get, begin_need_pay, all_need_get, all_need_pay,
  fax, telephone, address, tax_num, bank_name, account_number, tax_rate, sort,
  creator, tenant_id, delete_flag
)
SELECT 912, '华北电子科技', '赵工', '13900000002', NULL, 'PCB清洗服务客户-演示', 0, '客户', b'1',
       0, 0, 0, 0, 0, NULL, NULL, '北京', NULL, NULL, NULL, NULL, '2', 63, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_supplier WHERE id = 912 OR (supplier = '华北电子科技' AND tenant_id = 63));

-- Category
INSERT INTO jsh_material_category (
  id, name, category_level, parent_id, sort, serial_no, remark, create_time, update_time, tenant_id, delete_flag
)
SELECT 901, 'PCB清洗物料', NULL, NULL, '1', 'PCB', '演示分类', NOW(), NOW(), 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_category WHERE id = 901 OR (name = 'PCB清洗物料' AND tenant_id = 63));

-- Materials (codes used as bar_code / model)
-- RM-A001 表面活性剂, RM-B002 络合剂, RM-C003 纯水, FG-101 PCB清洗液, FG-102 除胶清洗液
INSERT INTO jsh_material (
  id, category_id, name, mfrs, model, standard, brand, mnemonic, color, unit, remark,
  img_name, unit_id, expiry_num, weight, enabled, other_field1, other_field2, other_field3,
  enable_serial_number, enable_batch_number, position, attribute, tenant_id, delete_flag
)
SELECT 901, 901, '表面活性剂', NULL, 'RM-A001', NULL, NULL, NULL, NULL, 'L', '演示原料',
       NULL, NULL, NULL, NULL, b'1', NULL, NULL, NULL, '0', '0', NULL, NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id = 901 OR (model = 'RM-A001' AND tenant_id = 63));

INSERT INTO jsh_material (
  id, category_id, name, mfrs, model, standard, brand, mnemonic, color, unit, remark,
  img_name, unit_id, expiry_num, weight, enabled, other_field1, other_field2, other_field3,
  enable_serial_number, enable_batch_number, position, attribute, tenant_id, delete_flag
)
SELECT 902, 901, '络合剂', NULL, 'RM-B002', NULL, NULL, NULL, NULL, 'L', '演示原料',
       NULL, NULL, NULL, NULL, b'1', NULL, NULL, NULL, '0', '0', NULL, NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id = 902 OR (model = 'RM-B002' AND tenant_id = 63));

INSERT INTO jsh_material (
  id, category_id, name, mfrs, model, standard, brand, mnemonic, color, unit, remark,
  img_name, unit_id, expiry_num, weight, enabled, other_field1, other_field2, other_field3,
  enable_serial_number, enable_batch_number, position, attribute, tenant_id, delete_flag
)
SELECT 903, 901, '纯水', NULL, 'RM-C003', NULL, NULL, NULL, NULL, 'L', '演示原料',
       NULL, NULL, NULL, NULL, b'1', NULL, NULL, NULL, '0', '0', NULL, NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id = 903 OR (model = 'RM-C003' AND tenant_id = 63));

INSERT INTO jsh_material (
  id, category_id, name, mfrs, model, standard, brand, mnemonic, color, unit, remark,
  img_name, unit_id, expiry_num, weight, enabled, other_field1, other_field2, other_field3,
  enable_serial_number, enable_batch_number, position, attribute, tenant_id, delete_flag
)
SELECT 911, 901, 'PCB清洗液', NULL, 'FG-101', NULL, NULL, NULL, NULL, 'L', '演示成品药水-虚构配比',
       NULL, NULL, NULL, NULL, b'1', NULL, NULL, NULL, '0', '0', NULL, NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id = 911 OR (model = 'FG-101' AND tenant_id = 63));

INSERT INTO jsh_material (
  id, category_id, name, mfrs, model, standard, brand, mnemonic, color, unit, remark,
  img_name, unit_id, expiry_num, weight, enabled, other_field1, other_field2, other_field3,
  enable_serial_number, enable_batch_number, position, attribute, tenant_id, delete_flag
)
SELECT 912, 901, '除胶清洗液', NULL, 'FG-102', NULL, NULL, NULL, NULL, 'L', '演示成品药水-虚构配比',
       NULL, NULL, NULL, NULL, b'1', NULL, NULL, NULL, '0', '0', NULL, NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material WHERE id = 912 OR (model = 'FG-102' AND tenant_id = 63));

-- Material extend / barcodes
INSERT INTO jsh_material_extend (
  id, material_id, bar_code, commodity_unit, sku, purchase_decimal, commodity_decimal, wholesale_decimal,
  low_decimal, default_flag, create_time, create_serial, update_serial, update_time, tenant_id, delete_Flag
)
SELECT 901, 901, 'RM-A001', 'L', NULL, 20.000000, 30.000000, 25.000000, NULL, '1', NOW(), 'jsh', 'jsh', NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id = 901 OR bar_code = 'RM-A001');

INSERT INTO jsh_material_extend (
  id, material_id, bar_code, commodity_unit, sku, purchase_decimal, commodity_decimal, wholesale_decimal,
  low_decimal, default_flag, create_time, create_serial, update_serial, update_time, tenant_id, delete_Flag
)
SELECT 902, 902, 'RM-B002', 'L', NULL, 35.000000, 50.000000, 40.000000, NULL, '1', NOW(), 'jsh', 'jsh', NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id = 902 OR bar_code = 'RM-B002');

INSERT INTO jsh_material_extend (
  id, material_id, bar_code, commodity_unit, sku, purchase_decimal, commodity_decimal, wholesale_decimal,
  low_decimal, default_flag, create_time, create_serial, update_serial, update_time, tenant_id, delete_Flag
)
SELECT 903, 903, 'RM-C003', 'L', NULL, 1.000000, 2.000000, 1.500000, NULL, '1', NOW(), 'jsh', 'jsh', NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id = 903 OR bar_code = 'RM-C003');

INSERT INTO jsh_material_extend (
  id, material_id, bar_code, commodity_unit, sku, purchase_decimal, commodity_decimal, wholesale_decimal,
  low_decimal, default_flag, create_time, create_serial, update_serial, update_time, tenant_id, delete_Flag
)
SELECT 911, 911, 'FG-101', 'L', NULL, 28.000000, 45.000000, 35.000000, NULL, '1', NOW(), 'jsh', 'jsh', NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id = 911 OR bar_code = 'FG-101');

INSERT INTO jsh_material_extend (
  id, material_id, bar_code, commodity_unit, sku, purchase_decimal, commodity_decimal, wholesale_decimal,
  low_decimal, default_flag, create_time, create_serial, update_serial, update_time, tenant_id, delete_Flag
)
SELECT 912, 912, 'FG-102', 'L', NULL, 32.000000, 55.000000, 40.000000, NULL, '1', NOW(), 'jsh', 'jsh', NULL, 63, '0'
WHERE NOT EXISTS (SELECT 1 FROM jsh_material_extend WHERE id = 912 OR bar_code = 'FG-102');

-- Ensure user jsh can use the two demo depots
UPDATE jsh_user_business
SET value = '[14][15]'
WHERE type = 'UserDepot' AND key_id = '63' AND tenant_id = 63;
