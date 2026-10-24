/**
 * Optional XLSX export for long tables (full data; PNG shows preview rows only).
 * All cell values are sanitized against formula injection.
 */
import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rowsOf, sanitizeSpreadsheetCell } from "./validate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "../../../..");

function loadExcelJS() {
  const candidates = [
    join(ROOT, ".tools", "aierp-020c-render", "package.json"),
    join(ROOT, ".tools", "excel-node", "package.json"),
    join(ROOT, "node_modules", "exceljs", "package.json"),
  ];
  for (const pkg of candidates) {
    if (!existsSync(pkg)) continue;
    try {
      return createRequire(pkg)("exceljs");
    } catch {
      // continue
    }
  }
  throw new Error("exceljs not found. npm install exceljs --prefix .tools/aierp-020c-render");
}

/**
 * @returns {Promise<Buffer>}
 */
export async function datasetToXlsxBuffer(dataset, meta = {}) {
  const ExcelJS = loadExcelJS();
  const book = new ExcelJS.Workbook();
  book.creator = "AIERP-020C";
  book.created = new Date();
  const sheet = book.addWorksheet(String(meta.title || "ERP数据").slice(0, 28) || "data");

  const columns = Array.isArray(dataset.columns) && dataset.columns.length
    ? dataset.columns
    : inferColumns(dataset);

  sheet.columns = columns.map((c) => ({
    header: sanitizeSpreadsheetCell(c.label || c.key),
    key: c.key,
    width: Math.min(28, Math.max(10, String(c.label || c.key).length + 4)),
  }));

  const rows = rowsOf(dataset);
  for (const row of rows) {
    const out = {};
    for (const c of columns) {
      out[c.key] = sanitizeSpreadsheetCell(row[c.key] ?? row[c.field] ?? "");
    }
    sheet.addRow(out);
  }

  const firstKey = columns[0]?.key || "A";
  sheet.addRow({});
  sheet.addRow({
    [firstKey]: sanitizeSpreadsheetCell(`来源：${meta.sourceLabel || "ERP"}`),
  });
  sheet.addRow({
    [firstKey]: sanitizeSpreadsheetCell(`生成：${meta.generatedAtZh || meta.generatedAt || ""}`),
  });
  if (meta.datasetRefId) {
    sheet.addRow({
      [firstKey]: sanitizeSpreadsheetCell(`datasetRef：${meta.datasetRefId}`),
    });
  }
  if (meta.provenance) {
    sheet.addRow({
      [firstKey]: sanitizeSpreadsheetCell(`provenance：${meta.provenance}`),
    });
  }

  const buf = await book.xlsx.writeBuffer();
  return Buffer.from(buf);
}

function inferColumns(dataset) {
  const rows = rowsOf(dataset);
  if (!rows.length) {
    return [
      { key: "label", label: "名称" },
      { key: "value", label: "数值" },
    ];
  }
  const keys = Object.keys(rows[0]).filter((k) => !/^_/.test(k));
  return keys.map((k) => ({ key: k, label: k }));
}

export function shouldExportXlsx(dataset, previewRows = 12) {
  return rowsOf(dataset).length > previewRows;
}
