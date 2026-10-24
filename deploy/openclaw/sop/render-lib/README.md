# AIERP-020C render-lib

Reusable ERP table/chart PNG (+ optional XLSX) library. See `docs/poc/adr/AIERP-020C-render-table-chart-library.md`.

**Authorization**: callers must never pass `authorized` / `nature:"REAL_ERP"` / inline numbers from the model.
Trusted ERP adapters seal a query result; the model only picks `renderId` + opaque `datasetRef.id`.

```js
import { sealAndRender, renderDataset, sealDataset } from "./index.mjs";
import { prepareWecomRender } from "./channel/wecom-render-hook.mjs";

// After a real authorized ERP query (adapter / SOP):
const authCtx = {
  tenantId: "63",
  actorUserId: "63",
  wecomUserId: "wx-user",
  botId: "default",
  bindingVersion: 1,
};

const result = await sealAndRender(
  authCtx,
  {
    renderId: "bar.compare",
    sourceKind: "ERP_QUERY",
    sourcePath: "/aierp/v1/wecom/stock/query",
    depotScope: ["原料仓"],
    dataset: {
      title: "各仓库存",
      unit: "kg",
      categories: [
        { label: "原料仓", value: 120 },
        { label: "成品仓", value: 85 },
      ],
    },
  },
  { writeFiles: true },
);
// result.png Buffer, result.alt, result.meta.provenance === "SERVER_SEALED_ERP"

// Model / channel path — opaque ref only:
const seal = sealDataset(authCtx, erpDataset, { sourcePath: "/aierp/v1/wecom/report/query" });
await renderDataset(
  { renderId: "table.basic", datasetRef: { id: seal.id } },
  { authCtx, writeFiles: true },
);
```

Deps (not committed): `npm install @resvg/resvg-js exceljs --prefix .tools/aierp-020c-render`
