/**
 * @suynda/contracts v0 — structural only.
 * Canonical definitions: /data (JSON) + /schema (JSON Schema).
 * This package wraps them for TypeScript; Python reads /data/*.json directly.
 * No commercial values. No business logic beyond validateEnvelope().
 */
export { MODULE_KEYS, MODULE_CLASSES, MODULE_LEVELS, PARTY_ROLES, IDENTITY_TYPES, CREDENTIAL_TYPES, IDENTIFIER_TYPES, LEDGER_TIPOS, PLAN_KEYS, ROLE_KEYS, PRIVILEGED_ROLE_KEYS, ENUMS, } from "./enums.js";
export { MODULES, moduleByKey, } from "./modules.js";
export { COMPRA_MANIFEST, LAB_MANIFEST, MANIFESTS, manifestByModuleKey, } from "./manifests.js";
export { EVENTS, EVENT_TYPES, } from "./events.js";
export { CAPABILITIES, } from "./capabilities.js";
export { ERROR_CODES, errorByCode, } from "./errors.js";
export { validateEnvelope, } from "./envelope.js";
export {} from "./reference.js";
export { METERED_OPERATIONS, } from "./metered-operations.js";
//# sourceMappingURL=index.js.map