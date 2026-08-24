import {
  validateEnvelope,
  MODULES,
  MODULE_KEYS,
  EVENTS,
  CAPABILITIES,
  ERROR_CODES,
  METERED_OPERATIONS,
  ENUMS,
  PLAN_KEYS,
  ROLE_KEYS,
  PRIVILEGED_ROLE_KEYS,
  COMPRA_MANIFEST,
  LAB_MANIFEST,
  MANIFESTS,
  manifestByModuleKey,
} from "../dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function sorted(arr) {
  return [...arr].sort();
}

function sameSet(a, b) {
  return JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));
}

/**
 * Generic walk over any ModuleManifest. Extracted so Lab (and future modules)
 * share uniqueness / referential checks. Compra-specific C7 arithmetic stays
 * in verifyCompraManifest — do not copy that function for Lab.
 */
function verifyManifestInvariants(m) {
  const errors = [];
  const fnKeys = m.functions.map((f) => f.function_key);
  const fnSet = new Set(fnKeys);
  if (fnSet.size !== fnKeys.length) {
    errors.push(`${m.module_key}: duplicate function_key`);
  }

  const roleKeys = m.roles.map((r) => r.role_key);
  const roleSet = new Set(roleKeys);
  if (roleSet.size !== roleKeys.length) {
    errors.push(`${m.module_key}: duplicate role_key`);
  }

  for (const role of m.roles) {
    for (const fk of role.functions) {
      if (!fnSet.has(fk)) {
        errors.push(
          `${m.module_key}: role ${role.role_key} references unknown function ${fk}`,
        );
      }
    }
  }

  for (const [grantor, grantees] of Object.entries(m.role_grant_matrix)) {
    if (!roleSet.has(grantor)) {
      errors.push(`${m.module_key}: role_grant_matrix key unknown: ${grantor}`);
    }
    for (const g of grantees) {
      if (!roleSet.has(g)) {
        errors.push(
          `${m.module_key}: role_grant_matrix[${grantor}] grants unknown role ${g}`,
        );
      }
    }
  }

  const delegable = new Set(
    m.functions.filter((f) => f.delegable).map((f) => f.function_key),
  );
  for (const profile of m.mandate_types) {
    for (const fk of profile.function_keys) {
      if (!delegable.has(fk)) {
        errors.push(
          `${m.module_key}: mandate profile ${profile.profile_key} lists non-delegable or unknown ${fk}`,
        );
      }
    }
  }

  for (const f of m.functions) {
    const st = f.scope_type;
    if (st === undefined || st === null) continue;
    if (typeof st !== "string" || st.length === 0) {
      errors.push(
        `${m.module_key}: ${f.function_key} scope_type must be omitted, null, or a non-empty string`,
      );
    }
  }

  return errors;
}

/** Wave A Lab: scoped only cargar/verificar; clinical functions not delegable. */
function verifyLabManifest(m) {
  const errors = [];
  if (m.module_key !== "lab") {
    errors.push(`lab manifest module_key must be lab; got ${m.module_key}`);
  }

  const scoped = new Set(["cargar", "verificar"]);
  const clinical = new Set(["cargar", "verificar", "caja", "excepcion_cobro"]);

  for (const f of m.functions) {
    const st = f.scope_type;
    if (scoped.has(f.function_key)) {
      if (typeof st !== "string" || st.length === 0) {
        errors.push(`${f.function_key} must declare a non-empty scope_type`);
      }
    } else if (st != null) {
      errors.push(`${f.function_key} must be unscoped (no scope_type)`);
    }

    if (clinical.has(f.function_key) && f.delegable !== false) {
      errors.push(`${f.function_key} must be delegable: false`);
    }
    if (f.function_key === "excepcion_cobro" && f.delegable !== false) {
      errors.push("excepcion_cobro must be non-delegable");
    }
  }

  if (!Array.isArray(m.mandate_types) || m.mandate_types.length !== 0) {
    errors.push("lab mandate_types must be [] in Wave A");
  }

  return errors;
}

/** Internal checks for data/manifests/compra.json (Bloque 1 / 6.1). */
function verifyCompraManifest(m) {
  const errors = [];
  const fnKeys = new Set(m.functions.map((f) => f.function_key));
  const roleKeys = new Set(m.roles.map((r) => r.role_key));
  const byRole = Object.fromEntries(
    m.roles.map((r) => [r.role_key, r.functions]),
  );

  const superadmin = byRole.superadmin ?? [];
  const admin = byRole.admin ?? [];
  const approver = byRole.approver ?? [];
  const uploader = byRole.uploader ?? [];

  const expectedSuper = sorted([...admin, "configurar_verificacion_fiscal"]);
  if (!sameSet(superadmin, expectedSuper)) {
    errors.push(
      `superadmin must equal admin + configurar_verificacion_fiscal; got ${JSON.stringify(sorted(superadmin))}`,
    );
  }

  const expectedApprover = sorted(
    admin.filter((f) => f !== "reprocesar_facturas"),
  );
  if (!sameSet(approver, expectedApprover)) {
    errors.push(
      `approver must equal admin − reprocesar_facturas; got ${JSON.stringify(sorted(approver))}`,
    );
  }

  if (!sameSet(uploader, ["cargar_facturas"])) {
    errors.push(
      `uploader must be only cargar_facturas; got ${JSON.stringify(uploader)}`,
    );
  }

  for (const role of m.roles) {
    for (const fk of role.functions) {
      if (!fnKeys.has(fk)) {
        errors.push(`role ${role.role_key} references unknown function ${fk}`);
      }
    }
  }

  for (const [grantor, grantees] of Object.entries(m.role_grant_matrix)) {
    if (!roleKeys.has(grantor)) {
      errors.push(`role_grant_matrix key unknown: ${grantor}`);
    }
    for (const g of grantees) {
      if (!roleKeys.has(g)) {
        errors.push(`role_grant_matrix[${grantor}] grants unknown role ${g}`);
      }
    }
  }

  for (const f of m.functions) {
    const expectCanal = f.function_key === "cargar_facturas";
    if (f.autorizada_por_canal !== expectCanal) {
      errors.push(
        `${f.function_key}: autorizada_por_canal should be ${expectCanal}`,
      );
    }
  }

  return errors;
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.(json|ts|md)$/.test(e.name)) out.push(p);
  }
  return out;
}

const good = {
  event: "party.created",
  version: 1,
  event_id: "evt-1",
  tenant_id: "550e8400-e29b-41d4-a716-446655440000",
  origen_module: "padron",
  ref: { id: "party-1" },
  entity_version: 1,
  change_mask: ["nombre"],
  occurred_at: "2026-07-23T12:00:00.000Z",
};
const bad = { ...good, extra_payload: { foo: 1 } };

const ok1 = validateEnvelope(good);
const ok2 = validateEnvelope(bad);

console.log("valid envelope:", ok1);
console.log("unknown field rejected:", ok2.ok === false, ok2.errors);
console.log("modules:", MODULES.length, "keys:", MODULE_KEYS.length);
console.log(
  "events:",
  EVENTS.length,
  "all v1:",
  EVENTS.every((e) => e.version === 1),
);
console.log("capabilities:", CAPABILITIES.length);
console.log("errors:", ERROR_CODES.length);
console.log(
  "metered:",
  METERED_OPERATIONS.length,
  "has creditos key?",
  METERED_OPERATIONS.some((o) => Object.hasOwn(o, "creditos")),
);
console.log("PlanKey:", PLAN_KEYS);
console.log(
  "enums ModuleKey order match:",
  JSON.stringify(ENUMS.ModuleKey) === JSON.stringify(MODULE_KEYS),
);

const dataFiles = walk("data");
const schemaFiles = walk("schema");
for (const f of [...dataFiles, ...schemaFiles]) {
  JSON.parse(readFileSync(f, "utf8"));
}
console.log("all data/schema JSON valid");

const dataText = dataFiles.map((f) => readFileSync(f, "utf8")).join("\n");
console.log('data has "creditos":', /"creditos"\s*:/.test(dataText));
console.log('data has "precio', /"precio/.test(dataText));

// Expected event types — derived from the canonical source (data/events.json),
// not hand-maintained here. This keeps the check as "the BUILT bundle (EVENTS in
// dist) still reflects the source rows" instead of a third hand-kept copy.
const expectedEvents = JSON.parse(
  readFileSync(join("data", "events.json"), "utf8"),
).map((e) => e.type);
const expectedMetered = JSON.parse(
  readFileSync(join("data", "metered-operations.json"), "utf8"),
).operations.length;
const actualTypes = EVENTS.map((e) => e.type);
const missing = expectedEvents.filter((t) => !actualTypes.includes(t));
const extra = actualTypes.filter((t) => !expectedEvents.includes(t));
console.log("event missing:", missing);
console.log("event extra:", extra);

// schema closed
const schema = JSON.parse(
  readFileSync("schema/event-envelope.schema.json", "utf8"),
);
console.log(
  "envelope additionalProperties:",
  schema.additionalProperties,
);

const rolesOk =
  JSON.stringify(ROLE_KEYS) ===
    JSON.stringify(["superadmin", "admin", "approver", "uploader"]) &&
  JSON.stringify(PRIVILEGED_ROLE_KEYS) ===
    JSON.stringify(["superadmin", "admin"]);
console.log("Role C7 catalog:", rolesOk, ROLE_KEYS, PRIVILEGED_ROLE_KEYS);

const manifestErrors = verifyCompraManifest(COMPRA_MANIFEST);
console.log("compra manifest checks:", manifestErrors.length === 0 ? "ok" : manifestErrors);

const compraUnscoped = COMPRA_MANIFEST.functions.every(
  (f) => f.scope_type === undefined || f.scope_type === null,
);
console.log("compra functions unscoped (no scope_type):", compraUnscoped);

const genericManifestErrors = MANIFESTS.flatMap(verifyManifestInvariants);
console.log(
  "generic manifest invariants:",
  genericManifestErrors.length === 0 ? "ok" : genericManifestErrors,
);

const labLookup = manifestByModuleKey("lab");
const compraLookup = manifestByModuleKey("compra");
const labLookupOk =
  labLookup === LAB_MANIFEST &&
  compraLookup === COMPRA_MANIFEST &&
  LAB_MANIFEST.module_key === "lab" &&
  MANIFESTS.length === 2;
console.log("manifestByModuleKey lab/compra:", labLookupOk);

const labErrors = verifyLabManifest(LAB_MANIFEST);
console.log("lab manifest checks:", labErrors.length === 0 ? "ok" : labErrors);

const resolveCap = CAPABILITIES.find((c) => c.key === "module_access.resolve");
const resolveCapOk =
  resolveCap?.availability === "FAIL_AFTER_GRACE" &&
  resolveCap?.initiator === "both";
console.log("module_access.resolve capability:", resolveCapOk);

const bannedLabCaps = CAPABILITIES.filter((c) => /^lab\./.test(c.key));
console.log("no lab.* product capabilities:", bannedLabCaps.length === 0);

const grantEvents = [
  "module_grant.created",
  "module_grant.role_changed",
  "module_grant.suspended",
  "module_grant.reactivated",
  "module_grant.scope_changed",
];
const grantEventsOk = grantEvents.every((t) => actualTypes.includes(t));
console.log("module_grant events present:", grantEventsOk);

const scopeChangedEnvelope = {
  event: "module_grant.scope_changed",
  version: 1,
  event_id: "evt-scope-1",
  tenant_id: "550e8400-e29b-41d4-a716-446655440000",
  origen_module: "foundation",
  ref: { id: "grant-1" },
  entity_version: 1,
  change_mask: ["scope_refs"],
  occurred_at: "2026-08-24T12:00:00.000Z",
};
const scopeChangedOk = validateEnvelope(scopeChangedEnvelope);
console.log("module_grant.scope_changed envelope:", scopeChangedOk);

const pass =
  ok1.ok === true &&
  ok2.ok === false &&
  MODULES.length === 15 &&
  MODULE_KEYS.length === 15 &&
  EVENTS.length === expectedEvents.length &&
  missing.length === 0 &&
  extra.length === 0 &&
  schema.additionalProperties === false &&
  !/"creditos"\s*:/.test(dataText) &&
  METERED_OPERATIONS.length === expectedMetered &&
  rolesOk &&
  manifestErrors.length === 0 &&
  compraUnscoped &&
  genericManifestErrors.length === 0 &&
  labLookupOk &&
  labErrors.length === 0 &&
  resolveCapOk &&
  bannedLabCaps.length === 0 &&
  grantEventsOk &&
  scopeChangedOk.ok === true;

console.log(pass ? "\nDoD CHECK: PASS" : "\nDoD CHECK: FAIL");
process.exit(pass ? 0 : 1);
