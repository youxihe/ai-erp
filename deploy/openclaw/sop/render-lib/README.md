# AIERP-020C render-lib

Reusable ERP table/chart PNG (+ optional XLSX) library. See `docs/poc/adr/AIERP-020C-render-table-chart-library.md`.

```js
import { renderDataset, listRenderCatalog } from "./index.mjs";
import { prepareWecomRender } from "./channel/wecom-render-hook.mjs";

const result = await renderDataset({
  renderId: "bar.compare", // whitelist only
  datasetRef: { id: "erp-query-id", authorized: true },
  dataset: {
    authorized: true,
    nature: "REAL_ERP",
    title: "各仓库存",
    unit: "kg",
    sourceLabel: "库存查询",
    categories: [
      { label: "原料仓", value: 120 },
      { label: "成品仓", value: 85 },
    ],
  },
});
// result.png Buffer, result.alt, result.degraded
```

Deps (not committed): `npm install @resvg/resvg-js exceljs --prefix .tools/aierp-020c-render`
