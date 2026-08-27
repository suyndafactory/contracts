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
  NUCLEO_MANIFEST,
  MANIFESTS,
  manifestByModuleKey,
} from "../dist/index.js";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormatsImport from "ajv-formats";

const pkg = JSON.parse(readFileSync(join("package.json"), "utf8"));
const addFormats =
  typeof addFormatsImport === "function"
    ? addFormatsImport
    : addFormatsImport.default;

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

/** Firmas congeladas del manifiesto Núcleo (Contract Change Package v1.0 / MC-02). */
function verifyNucleoManifest(m) {
  const errors = [];
  if (m.module_key !== "nucleo") {
    errors.push(`nucleo manifest module_key must be nucleo; got ${m.module_key}`);
  }
  if (m.manifest_version !== 1) {
    errors.push(`nucleo manifest_version must be 1; got ${m.manifest_version}`);
  }
  if (!Array.isArray(m.roles) || m.roles.length !== 0) {
    errors.push("nucleo roles must be [] (lab pattern; no ROLE_KEYS)");
  }
  if (Object.keys(m.role_grant_matrix ?? {}).length !== 0) {
    errors.push("nucleo role_grant_matrix must be {}");
  }
  if (!Array.isArray(m.mandate_types) || m.mandate_types.length !== 0) {
    errors.push("nucleo mandate_types must be [] in V1");
  }

  const expectedFns = [
    "ver_libro",
    "operar_registro",
    "aprobar",
    "cerrar_periodo",
    "aplicar_comun_acotado",
    "operar_contribuyente",
    "configurar",
  ];
  const actualFns = m.functions.map((f) => f.function_key);
  if (!sameSet(actualFns, expectedFns) || actualFns.length !== expectedFns.length) {
    errors.push(
      `nucleo functions must be exactly ${JSON.stringify(expectedFns)}; got ${JSON.stringify(sorted(actualFns))}`,
    );
  }

  const delegableExpected = new Set([
    "ver_libro",
    "operar_registro",
    "aprobar",
    "aplicar_comun_acotado",
  ]);
  for (const f of m.functions) {
    const st = f.scope_type;
    if (st !== undefined && st !== null) {
      errors.push(`${f.function_key} must be unscoped (no scope_type)`);
    }
    const expectDelegable = delegableExpected.has(f.function_key);
    if (f.delegable !== expectDelegable) {
      errors.push(
        `${f.function_key}: delegable must be ${expectDelegable}`,
      );
    }
  }

  const aplicar = m.functions.find((f) => f.function_key === "aplicar_comun_acotado");
  if (!aplicar) {
    errors.push("aplicar_comun_acotado must exist as an individually grantable function");
  }

  const MATRIZ = {
    operacion: ["ver_libro", "operar_registro"],
    aprobacion: ["ver_libro", "operar_registro", "aprobar", "cerrar_periodo"],
    direccion: [
      "ver_libro",
      "operar_registro",
      "aprobar",
      "cerrar_periodo",
      "operar_contribuyente",
      "configurar",
    ],
  };
  const presets = m.permission_presets ?? [];
  if (!sameSet(presets.map((p) => p.preset_key), Object.keys(MATRIZ))) {
    errors.push(
      `nucleo presets must be exactly ${JSON.stringify(Object.keys(MATRIZ))}; got ${JSON.stringify(sorted(presets.map((p) => p.preset_key)))}`,
    );
  }
  for (const p of presets) {
    const expected = MATRIZ[p.preset_key];
    if (expected && !sameSet(p.functions, expected)) {
      errors.push(
        `nucleo preset ${p.preset_key} must be ${JSON.stringify(expected)}; got ${JSON.stringify(sorted(p.functions))}`,
      );
    }
    if (p.functions.includes("aplicar_comun_acotado")) {
      errors.push(
        `nucleo preset ${p.preset_key} must EXCLUDE aplicar_comun_acotado (explicit individual grant only)`,
      );
    }
  }

  return errors;
}

function duplicates(arr) {
  const seen = new Set();
  const dups = [];
  for (const x of arr) {
    if (seen.has(x)) dups.push(x);
    seen.add(x);
  }
  return dups;
}

function compileSchema(schema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function schemaResult(validate, obj) {
  const ok = validate(obj) === true;
  const errors = (validate.errors ?? []).map((e) => {
    const path = e.instancePath === "" ? "/" : e.instancePath;
    return `${path} ${e.message ?? "invalid"}`.trim();
  });
  return { ok, errors };
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
  manifestByModuleKey("nucleo") === NUCLEO_MANIFEST &&
  MANIFESTS.length === 3;
console.log("manifestByModuleKey lab/compra/nucleo:", labLookupOk);

const nucleoErrors = verifyNucleoManifest(NUCLEO_MANIFEST);
console.log("nucleo manifest checks:", nucleoErrors.length === 0 ? "ok" : nucleoErrors);

const versionOk = pkg.version === "0.9.0";
console.log("package version 0.9.0:", versionOk);

const contributorCap = CAPABILITIES.find((c) => c.key === "contributor_context.read");
const contributorCapOk =
  contributorCap?.availability === "FAIL_CLOSED" &&
  contributorCap?.initiator === "system";
console.log("contributor_context.read capability:", contributorCapOk);

const nucleoCaps = CAPABILITIES.filter((c) => /^nucleo\./.test(c.key));
console.log("no nucleo.* capabilities:", nucleoCaps.length === 0, nucleoCaps.map((c) => c.key));

const nucleoEvents = actualTypes.filter((t) => /^nucleo\./.test(t));
console.log("no nucleo.* EventTypes:", nucleoEvents.length === 0, nucleoEvents);

const purchaseVoidedOk = actualTypes.includes("purchase.voided");
const purchaseRejectedOk = actualTypes.includes("purchase.rejected");
const purchaseApprovedOk = actualTypes.includes("purchase.approved");
console.log("purchase.voided present:", purchaseVoidedOk);
console.log("purchase.rejected present (pre-approval):", purchaseRejectedOk);
console.log("purchase.approved present (entity_version re-pull):", purchaseApprovedOk);

const voidedEnvelope = {
  event: "purchase.voided",
  version: 1,
  event_id: "evt-void-1",
  tenant_id: "550e8400-e29b-41d4-a716-446655440000",
  origen_module: "compra",
  ref: { id: "purchase-1" },
  entity_version: 2,
  change_mask: ["status"],
  occurred_at: "2026-08-26T12:00:00.000Z",
};
const voidedOk = validateEnvelope(voidedEnvelope);
const voidedExtra = validateEnvelope({ ...voidedEnvelope, amount: 100 });
console.log("purchase.voided envelope:", voidedOk);
console.log("purchase.voided extra payload rejected:", voidedExtra.ok === false);

const rejectedEnvelope = {
  event: "purchase.rejected",
  version: 1,
  event_id: "evt-rej-1",
  tenant_id: "550e8400-e29b-41d4-a716-446655440000",
  origen_module: "compra",
  ref: { id: "purchase-2" },
  entity_version: 1,
  change_mask: ["status"],
  occurred_at: "2026-08-26T12:00:00.000Z",
};
const rejectedOk = validateEnvelope(rejectedEnvelope);
console.log("purchase.rejected envelope (pre-approval):", rejectedOk);

const approvedV2 = {
  event: "purchase.approved",
  version: 1,
  event_id: "evt-appr-2",
  tenant_id: "550e8400-e29b-41d4-a716-446655440000",
  origen_module: "compra",
  ref: { id: "purchase-1" },
  entity_version: 3,
  change_mask: ["status"],
  occurred_at: "2026-08-26T13:00:00.000Z",
};
const approvedV2Ok = validateEnvelope(approvedV2);
console.log("purchase.approved re-emit entity_version:", approvedV2Ok);

const ENVELOPE_REQUIRED = [
  "event",
  "version",
  "event_id",
  "tenant_id",
  "origen_module",
  "ref",
  "entity_version",
  "change_mask",
  "occurred_at",
];
const envelopeShapeOk =
  schema.additionalProperties === false &&
  JSON.stringify(schema.required) === JSON.stringify(ENVELOPE_REQUIRED) &&
  schema.properties.ref.additionalProperties === false &&
  JSON.stringify(schema.properties.ref.required) === JSON.stringify(["id"]) &&
  Object.keys(schema.properties).length === ENVELOPE_REQUIRED.length;
console.log("envelope shape unchanged:", envelopeShapeOk);

const eventDups = duplicates(actualTypes);
const capDups = duplicates(CAPABILITIES.map((c) => c.key));
console.log("event type duplicates:", eventDups);
console.log("capability key duplicates:", capDups);

const contributorSchema = JSON.parse(
  readFileSync(join("schema", "contributor-context.schema.json"), "utf8"),
);
const temporalSchema = JSON.parse(
  readFileSync(join("schema", "temporal-identity-resolution.schema.json"), "utf8"),
);
const validateContributor = compileSchema(contributorSchema);
const validateTemporal = compileSchema(temporalSchema);

const ctxGroup = {
  context_ref: "11111111-1111-1111-1111-111111111111",
  documento: { tipo: "RUC", pais: "PY", valor: "80012345-6" },
  tenants: [
    { tenant_id: "550e8400-e29b-41d4-a716-446655440000" },
    { tenant_id: "550e8400-e29b-41d4-a716-446655440001" },
  ],
  entity_version: 1,
  resolved_at: "2026-08-26T12:00:00.000Z",
};
const ctxNull = {
  context_ref: null,
  documento: { tipo: "RUC", pais: "PY", valor: "80012345-6" },
  tenants: [{ tenant_id: "550e8400-e29b-41d4-a716-446655440000" }],
  entity_version: 1,
  resolved_at: "2026-08-26T12:00:00.000Z",
};
const ctxNullDoc = {
  context_ref: null,
  documento: null,
  tenants: [{ tenant_id: "550e8400-e29b-41d4-a716-446655440000" }],
  entity_version: 1,
  resolved_at: "2026-08-26T12:00:00.000Z",
};
const ctxGood = schemaResult(validateContributor, ctxGroup);
const ctxNullGood = schemaResult(validateContributor, ctxNull);
const ctxNullDocGood = schemaResult(validateContributor, ctxNullDoc);
const ctxExtra = schemaResult(validateContributor, {
  ...ctxNull,
  dueno_user_id: "user-1",
});
const ctxFiscal = schemaResult(validateContributor, {
  ...ctxNull,
  fiscal_profile: { ruc: "80012345-6" },
});
const ctxMissingTenants = schemaResult(validateContributor, {
  context_ref: null,
  documento: null,
  entity_version: 1,
  resolved_at: "2026-08-26T12:00:00.000Z",
});
console.log("ContributorContext group:", ctxGood.ok);
console.log("ContributorContext context_ref:null:", ctxNullGood.ok);
console.log("ContributorContext degenerate documento null:", ctxNullDocGood.ok);
console.log("ContributorContext extra field rejected:", ctxExtra.ok === false);
console.log("ContributorContext fiscal extra rejected:", ctxFiscal.ok === false);
console.log("ContributorContext missing tenants rejected:", ctxMissingTenants.ok === false);

const temporalResolved = schemaResult(validateTemporal, {
  resolution: "resolved",
  effective_at: "2026-08-01",
  entity_version: 1,
});
const temporalNotFound = schemaResult(validateTemporal, {
  resolution: "not_found",
  effective_at: "2026-08-01",
  entity_version: null,
});
const temporalInsufficient = schemaResult(validateTemporal, {
  resolution: "insufficient_history",
  effective_at: "2026-08-01",
  entity_version: null,
});
const temporalSnapshot = schemaResult(validateTemporal, {
  resolution: "resolved",
  effective_at: "2026-08-01",
  entity_version: 1,
  fiscal_profile: { ruc: "80012345-6" },
});
const temporalParty = schemaResult(validateTemporal, {
  resolution: "resolved",
  effective_at: "2026-08-01",
  entity_version: 1,
  party: { id: "p1" },
});
const temporalResolvedNullVer = schemaResult(validateTemporal, {
  resolution: "resolved",
  effective_at: "2026-08-01",
  entity_version: null,
});
const temporalNotFoundWithVer = schemaResult(validateTemporal, {
  resolution: "not_found",
  effective_at: "2026-08-01",
  entity_version: 1,
});
console.log("TemporalIdentityResolution resolved:", temporalResolved.ok);
console.log("TemporalIdentityResolution not_found:", temporalNotFound.ok);
console.log("TemporalIdentityResolution insufficient_history:", temporalInsufficient.ok);
console.log("TemporalIdentityResolution fiscal snapshot rejected:", temporalSnapshot.ok === false);
console.log("TemporalIdentityResolution party snapshot rejected:", temporalParty.ok === false);
console.log("TemporalIdentityResolution resolved requires entity_version:", temporalResolvedNullVer.ok === false);
console.log("TemporalIdentityResolution not_found forbids entity_version:", temporalNotFoundWithVer.ok === false);

const contributorClosed = contributorSchema.additionalProperties === false;
const temporalClosed = temporalSchema.additionalProperties === false;
console.log("ContributorContext schema closed:", contributorClosed);
console.log("TemporalIdentityResolution schema closed:", temporalClosed);

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
  grantEventsOk &&
  nucleoErrors.length === 0 &&
  versionOk &&
  contributorCapOk &&
  nucleoCaps.length === 0 &&
  nucleoEvents.length === 0 &&
  purchaseVoidedOk &&
  purchaseRejectedOk &&
  purchaseApprovedOk &&
  voidedOk.ok === true &&
  voidedExtra.ok === false &&
  rejectedOk.ok === true &&
  approvedV2Ok.ok === true &&
  envelopeShapeOk &&
  eventDups.length === 0 &&
  capDups.length === 0 &&
  ctxGood.ok &&
  ctxNullGood.ok &&
  ctxNullDocGood.ok &&
  ctxExtra.ok === false &&
  ctxFiscal.ok === false &&
  ctxMissingTenants.ok === false &&
  temporalResolved.ok &&
  temporalNotFound.ok &&
  temporalInsufficient.ok &&
  temporalSnapshot.ok === false &&
  temporalParty.ok === false &&
  temporalResolvedNullVer.ok === false &&
  temporalNotFoundWithVer.ok === false &&
  contributorClosed &&
  temporalClosed;

console.log(pass ? "\nDoD CHECK: PASS" : "\nDoD CHECK: FAIL");
process.exit(pass ? 0 : 1);
