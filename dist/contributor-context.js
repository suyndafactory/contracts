/**
 * Module-facing contributor context (Núcleo v0.9.0 / MC-01).
 *
 * Foundation produces this object; Núcleo consumes it. Shapes for `documento`
 * and `tenants` are inline on purpose — this package does not introduce
 * DocumentoRef / TenantRef types for this surface.
 *
 * Normative rules:
 * 1. `context_ref` is NOT a global tax identity. It preserves the real group
 *    key (owner + documento). Two contexts may share `documento`. Consumers
 *    must not derive global tax identity from `context_ref` or `documento`.
 * 2. Degenerate case: if the queried tenant has no `grupo_id`, Foundation
 *    returns `context_ref: null`, `tenants: [that single tenant]`, and
 *    `documento` taken from the tenant RUC when it exists. Do not invent a
 *    synthetic group.
 * 3. The read is "current now". `entity_version` + `resolved_at` detect
 *    change. Foundation does not version group-membership history in V1.
 * 4. Closed: this object does not return owner/superadmin user ids, user
 *    directory, memberships, mandates/tutelas, balances, entitlements of
 *    other modules, other groups of the same documento, or inverse lookup
 *    by documento.
 * 5. Topology ≠ authorization. A `tenant_id` in `tenants[]` shows belonging
 *    only; it does not grant read or write on that space.
 */
export {};
//# sourceMappingURL=contributor-context.js.map