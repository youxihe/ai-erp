/**
 * Server-authoritative dataset registry for AIERP-020C.
 *
 * Model-facing callers may only pass an opaque datasetRef.id.
 * Datasets are sealed by trusted ERP adapters after a real authorized query.
 * Resolve re-checks tenant / actor / wecomUser / bot / bindingVersion / TTL.
 */
import { createHash, randomBytes } from "node:crypto";

const DEFAULT_TTL_MS = 30 * 60 * 1000;
const MAX_ENTRIES = 500;

/** @type {Map<string, object>} */
const STORE = new Map();

function prune(now = Date.now()) {
  for (const [id, row] of STORE) {
    if (row.expiresAt <= now) STORE.delete(id);
  }
  while (STORE.size > MAX_ENTRIES) {
    const first = STORE.keys().next().value;
    if (first == null) break;
    STORE.delete(first);
  }
}

function requireAuthCtx(authCtx) {
  if (!authCtx || typeof authCtx !== "object") {
    throw new Error("authCtx_required");
  }
  const tenantId = authCtx.tenantId ?? authCtx.tenant_id;
  const actorUserId = authCtx.actorUserId ?? authCtx.erpUserId ?? authCtx.userId;
  const wecomUserId = String(authCtx.wecomUserId || "").trim();
  const botId = String(authCtx.botId || "").trim();
  const bindingVersion = Number(authCtx.bindingVersion ?? authCtx.binding_version ?? 0);
  if (tenantId == null || actorUserId == null || !wecomUserId || !botId) {
    throw new Error("authCtx_incomplete");
  }
  return {
    tenantId: String(tenantId),
    actorUserId: String(actorUserId),
    wecomUserId,
    botId,
    bindingVersion: Number.isFinite(bindingVersion) ? bindingVersion : 0,
  };
}

function fingerprint(dataset) {
  return createHash("sha256")
    .update(JSON.stringify(dataset || {}))
    .digest("hex");
}

/**
 * Seal a canonical ERP dataset after a trusted authorized query.
 * @returns {{ id: string, expiresAt: number, datasetSha256: string }}
 */
export function sealDataset(authCtx, dataset, opts = {}) {
  prune();
  const auth = requireAuthCtx(authCtx);
  if (!dataset || typeof dataset !== "object") {
    throw new Error("dataset_required");
  }
  // Strip any caller trust badges — provenance is the seal itself.
  const clean = { ...dataset };
  delete clean.authorized;
  delete clean.nature;
  delete clean.sourceRefs;

  const ttlMs = Math.min(
    Math.max(Number(opts.ttlMs) || DEFAULT_TTL_MS, 60_000),
    2 * 60 * 60 * 1000,
  );
  const id = `ds_${randomBytes(16).toString("hex")}`;
  const now = Date.now();
  const row = {
    id,
    ...auth,
    dataset: clean,
    datasetSha256: fingerprint(clean),
    sourceKind: String(opts.sourceKind || "ERP_QUERY"),
    sourcePath: opts.sourcePath ? String(opts.sourcePath).slice(0, 120) : undefined,
    depotScope: Array.isArray(opts.depotScope) ? opts.depotScope.map(String) : undefined,
    createdAt: now,
    expiresAt: now + ttlMs,
  };
  STORE.set(id, row);
  return { id, expiresAt: row.expiresAt, datasetSha256: row.datasetSha256 };
}

/**
 * Resolve opaque datasetRef for the current authenticated WeCom/ERP identity.
 * @returns {{ ok: true, dataset: object, meta: object } | { ok: false, reason: string }}
 */
export function resolveSealedDataset(authCtx, datasetRef) {
  prune();
  let auth;
  try {
    auth = requireAuthCtx(authCtx);
  } catch (err) {
    return { ok: false, reason: String(err?.message || err) };
  }

  const id =
    typeof datasetRef === "string"
      ? datasetRef.trim()
      : String(datasetRef?.id || datasetRef?.datasetId || "").trim();
  if (!id || !/^ds_[a-f0-9]{32}$/i.test(id)) {
    return { ok: false, reason: "datasetRef_unknown_or_malformed" };
  }

  // Ignore caller-supplied authorized/nature/sourceLabel on the ref object.
  const row = STORE.get(id);
  if (!row) {
    return { ok: false, reason: "datasetRef_unknown_or_expired" };
  }
  if (row.expiresAt <= Date.now()) {
    STORE.delete(id);
    return { ok: false, reason: "datasetRef_expired" };
  }
  if (row.tenantId !== auth.tenantId) {
    return { ok: false, reason: "datasetRef_tenant_mismatch" };
  }
  if (row.actorUserId !== auth.actorUserId) {
    return { ok: false, reason: "datasetRef_actor_mismatch" };
  }
  if (row.wecomUserId !== auth.wecomUserId) {
    return { ok: false, reason: "datasetRef_sender_mismatch" };
  }
  if (row.botId !== auth.botId) {
    return { ok: false, reason: "datasetRef_bot_mismatch" };
  }
  if (row.bindingVersion !== auth.bindingVersion) {
    return { ok: false, reason: "datasetRef_binding_version_mismatch" };
  }

  return {
    ok: true,
    dataset: structuredClone ? structuredClone(row.dataset) : JSON.parse(JSON.stringify(row.dataset)),
    meta: {
      datasetRefId: row.id,
      datasetSha256: row.datasetSha256,
      sourceKind: row.sourceKind,
      sourcePath: row.sourcePath,
      sealedAt: row.createdAt,
      expiresAt: row.expiresAt,
      provenance: "SERVER_SEALED_ERP",
    },
  };
}

/** Test helper — clear registry between unit cases. */
export function __clearDatasetRegistryForTests() {
  STORE.clear();
}

export function __registrySizeForTests() {
  prune();
  return STORE.size;
}
