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
 * Internal checks for data/manifests/compra.json (Bloque 1 / 6.1).
 *
 * v0.8.1 — RECONCILIACIÓN EQ-3. La aritmética C7 que vivía acá (superadmin =
 * admin + configurar_verificacion_fiscal; approver = admin − reprocesar;
 * uploader = solo cargar) describía una derivación rol→función que
 * **producción apagó el 24-ago-2026** (DELETE manual sobre
 * module_role_functions, censo FIX-1). El manifiesto ahora declara ese
 * estado: los cuatro roles con `functions: []`.
 *
 * `roles` y `role_grant_matrix` NO se vacían: los roles sostienen la FK de
 * module_access_grants (034) y la matriz es la autoridad C7 que consume
 * invitations (foundation catalog/role-grant-matrix.ts). Lo único que muere
 * es la derivación de funciones.
 *
 * El assert que reemplaza a la aritmética es lo que hace SATISFACIBLE el gate
 * anti-resurrección del Plan v1.1 (enmienda 2): sembrar este manifiesto desde
 * cero deja module_role_functions de compra en 0, igual que el upgrade.
 */
function verifyCompraManifest(m) {
  const errors = [];
  const fnKeys = new Set(m.functions.map((f) => f.function_key));
  const roleKeys = new Set(m.roles.map((r) => r.role_key));

  // Los cuatro roles C7 siguen declarados (la FK de module_access_grants y la
  // matriz de invitations los necesitan) …
  const C7 = ["superadmin", "admin", "approver", "uploader"];
  if (!sameSet(m.roles.map((r) => r.role_key), C7)) {
    errors.push(
      `compra roles must remain exactly ${JSON.stringify(C7)}; got ${JSON.stringify(sorted(m.roles.map((r) => r.role_key)))}`,
    );
  }
  // … y NINGUNO deriva funciones. Un rol con functions no vacío resucitaría
  // la derivación que EQ-3 apagó en producción.
  for (const role of m.roles) {
    if (!Array.isArray(role.functions) || role.functions.length !== 0) {
      errors.push(
        `compra role ${role.role_key} must declare functions: [] (EQ-3 — la derivación rol→función está apagada); got ${JSON.stringify(role.functions)}`,
      );
    }
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

/**
 * Guards genéricos v0.8.0 (Plan de Integración Canónica v1.1 §4) — corren
 * sobre TODOS los manifiestos; compra los pasa trivialmente (sin scopes ni
 * presets). No tocan la aritmética C7 de verifyCompraManifest.
 */
function verifyManifestShared(m) {
  const errors = [];
  const fnByKey = new Map(m.functions.map((f) => [f.function_key, f]));

  for (const f of m.functions) {
    const st = f.scope_type;
    if (st === undefined || st === null) continue;
    if (typeof st !== "string" || st.trim() === "") {
      errors.push(
        `${m.module_key}/${f.function_key}: scope_type must be omitted, null, or a non-empty string`,
      );
      continue;
    }
    if (st === "*" || st.toLowerCase() === "all") {
      errors.push(
        `${m.module_key}/${f.function_key}: scope_type magic string prohibited (${st})`,
      );
    }
    // Guard firmado: scoped ⇒ no delegable (V1).
    if (f.delegable !== false) {
      errors.push(
        `${m.module_key}/${f.function_key}: scoped function must be delegable: false`,
      );
    }
  }

  // Guard firmado: una función con scope no compone roles.
  for (const role of m.roles) {
    for (const fk of role.functions) {
      const fn = fnByKey.get(fk);
      if (fn && fn.scope_type !== undefined && fn.scope_type !== null) {
        errors.push(
          `${m.module_key}: role ${role.role_key} includes scoped function ${fk}`,
        );
      }
    }
  }

  // Guard firmado: preset referencia función existente del MISMO manifiesto.
  const presets = m.permission_presets ?? [];
  const presetKeys = new Set();
  for (const p of presets) {
    if (typeof p.preset_key !== "string" || p.preset_key.trim() === "") {
      errors.push(`${m.module_key}: preset_key must be a non-empty string`);
      continue;
    }
    if (presetKeys.has(p.preset_key)) {
      errors.push(`${m.module_key}: duplicate preset_key ${p.preset_key}`);
    }
    presetKeys.add(p.preset_key);
    if (typeof p.nombre !== "string" || p.nombre.trim() === "") {
      errors.push(`${m.module_key}/${p.preset_key}: preset nombre must be non-empty`);
    }
    if (typeof p.orden !== "number") {
      errors.push(`${m.module_key}/${p.preset_key}: preset orden must be a number`);
    }
    if (!Array.isArray(p.functions) || p.functions.length === 0) {
      errors.push(
        `${m.module_key}/${p.preset_key}: preset functions must list at least one function_key`,
      );
      continue;
    }
    for (const fk of p.functions) {
      if (!fnByKey.has(fk)) {
        errors.push(
          `${m.module_key}/${p.preset_key}: preset references unknown function ${fk}`,
        );
      }
    }
  }

  // Guard firmado (§5.d): los conjuntos de funciones de los presets de un
  // módulo son distintos entre sí — el rótulo derivado del hub lo exige.
  // Igualdad de CONJUNTO (dedup + orden-independiente), no del array.
  const bySetSignature = new Map();
  for (const p of presets) {
    if (typeof p.preset_key !== "string" || !Array.isArray(p.functions)) continue;
    const sig = JSON.stringify(sorted([...new Set(p.functions)]));
    const prev = bySetSignature.get(sig);
    if (prev !== undefined) {
      errors.push(
        `${m.module_key}: presets ${prev} and ${p.preset_key} share the same function set`,
      );
    } else {
      bySetSignature.set(sig, p.preset_key);
    }
  }

  return errors;
}

/** Las firmas congeladas del manifiesto lab (26-ago) — que no derritan en silencio. */
function verifyLabManifest(m) {
  const errors = [];
  if (m.module_key !== "lab") {
    errors.push(`lab manifest module_key must be lab; got ${m.module_key}`);
  }
  if (m.roles.length !== 0) {
    errors.push("lab roles must be [] (firma: acceso 100% por tildes)");
  }
  if (Object.keys(m.role_grant_matrix).length !== 0) {
    errors.push("lab role_grant_matrix must be {}");
  }
  if (m.mandate_types.length !== 0) {
    errors.push("lab mandate_types must be [] in V1");
  }

  const scoped = m.functions.filter(
    (f) => f.scope_type !== undefined && f.scope_type !== null,
  );
  if (!sameSet(scoped.map((f) => f.function_key), ["cargar", "verificar"])) {
    errors.push(
      `lab scoped functions must be exactly cargar+verificar; got ${JSON.stringify(sorted(scoped.map((f) => f.function_key)))}`,
    );
  }
  for (const f of scoped) {
    if (f.scope_type !== "departamento") {
      errors.push(
        `${f.function_key}: scope_type must be "departamento"; got ${f.scope_type}`,
      );
    }
  }

  const configurar = m.functions.find((f) => f.function_key === "configurar");
  if (!configurar) {
    errors.push("lab must declare configurar");
  } else {
    if (configurar.delegable !== false) {
      errors.push("configurar must be delegable: false");
    }
    if (configurar.scope_type !== undefined && configurar.scope_type !== null) {
      errors.push("configurar must be unscoped");
    }
  }

  const MATRIZ = {
    admision: ["ver", "admitir", "muestras", "entregar"],
    carga: ["ver", "cargar"],
    verificacion: ["ver", "verificar"],
    configuracion: ["ver", "configurar"],
  };
  const presets = m.permission_presets ?? [];
  if (!sameSet(presets.map((p) => p.preset_key), Object.keys(MATRIZ))) {
    errors.push(
      `lab presets must be exactly ${JSON.stringify(Object.keys(MATRIZ))}; got ${JSON.stringify(sorted(presets.map((p) => p.preset_key)))}`,
    );
  }
  for (const p of presets) {
    const expected = MATRIZ[p.preset_key];
    if (expected && !sameSet(p.functions, expected)) {
      errors.push(
        `lab preset ${p.preset_key} must be ${JSON.stringify(expected)}; got ${JSON.stringify(sorted(p.functions))}`,
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

const sharedManifestErrors = MANIFESTS.flatMap(verifyManifestShared);
console.log(
  "shared manifest guards:",
  sharedManifestErrors.length === 0 ? "ok" : sharedManifestErrors,
);

const labErrors = verifyLabManifest(LAB_MANIFEST);
console.log("lab manifest checks:", labErrors.length === 0 ? "ok" : labErrors);

const labLookupOk =
  manifestByModuleKey("lab") === LAB_MANIFEST &&
  manifestByModuleKey("compra") === COMPRA_MANIFEST &&
  MANIFESTS.length === 2;
console.log("manifestByModuleKey lab/compra:", labLookupOk);

// Guard firmado 4, tripwire ejecutable: sin enum global de scope types — a
// propósito. Si algún día aparece "ScopeType" en data/enums.json, el DoD
// grita en vez de aceptarlo en silencio.
const enumsRaw = JSON.parse(readFileSync(join("data", "enums.json"), "utf8"));
const noScopeTypeEnum = !Object.hasOwn(enumsRaw, "ScopeType");
console.log("no global ScopeType enum:", noScopeTypeEnum);

const grantEvents = [
  "module_grant.created",
  "module_grant.role_changed",
  "module_grant.suspended",
  "module_grant.reactivated",
];
const grantEventsOk = grantEvents.every((t) => actualTypes.includes(t));
console.log("module_grant events present:", grantEventsOk);

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
  sharedManifestErrors.length === 0 &&
  labErrors.length === 0 &&
  labLookupOk &&
  noScopeTypeEnum &&
  grantEventsOk;

console.log(pass ? "\nDoD CHECK: PASS" : "\nDoD CHECK: FAIL");
process.exit(pass ? 0 : 1);
