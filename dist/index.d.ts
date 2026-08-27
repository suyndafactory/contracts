/**
 * @suynda/contracts v0 — structural only.
 * Canonical definitions: /data (JSON) + /schema (JSON Schema).
 * This package wraps them for TypeScript; Python reads /data/*.json directly.
 * No commercial values. No business logic beyond validateEnvelope().
 */
export { MODULE_KEYS, MODULE_CLASSES, MODULE_LEVELS, PARTY_ROLES, IDENTITY_TYPES, CREDENTIAL_TYPES, IDENTIFIER_TYPES, LEDGER_TIPOS, PLAN_KEYS, ROLE_KEYS, PRIVILEGED_ROLE_KEYS, ENUMS, type ModuleKey, type ModuleClass, type ModuleLevel, type PartyRole, type IdentityType, type CredentialType, type IdentifierType, type LedgerTipo, type PlanKey, type Role, } from "./enums.js";
export { MODULES, moduleByKey, type ModuleSeed, } from "./modules.js";
export { COMPRA_MANIFEST, LAB_MANIFEST, MANIFESTS, manifestByModuleKey, type ModuleManifest, type ManifestFunction, type ManifestRole, type ManifestPermissionPreset, } from "./manifests.js";
export { EVENTS, EVENT_TYPES, type EventCatalogEntry, type EventType, } from "./events.js";
export { CAPABILITIES, type Capability, type CapabilityKey, type CapabilityAvailability, type CapabilityInitiator, } from "./capabilities.js";
export { ERROR_CODES, errorByCode, type ErrorCode, type ErrorCodeKey, } from "./errors.js";
export { validateEnvelope, type EventEnvelope, type EventRef, type ValidateEnvelopeResult, } from "./envelope.js";
export { type ReferenceCacheColumns, type PartyReference, type ItemReference, type ReferenceColumns, } from "./reference.js";
export { METERED_OPERATIONS, type MeteredOperation, type MeteredOperationKey, } from "./metered-operations.js";
//# sourceMappingURL=index.d.ts.map