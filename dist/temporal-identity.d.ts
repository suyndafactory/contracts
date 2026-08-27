/**
 * Temporal identity resolution metadata (Núcleo v0.9.0 / MC-03).
 *
 * This is resolution metadata, not a Party / fiscal-profile snapshot.
 * Padrón remains owner of identity and of the fiscal snapshot. The consumer
 * composes this metadata with Padrón's current Party / fiscal-profile shape:
 * - `resolved` ⇒ metadata + Padrón snapshot of that version
 * - `not_found` / `insufficient_history` ⇒ metadata without snapshot
 *
 * The snapshot MUST NOT be duplicated or lifted into this package.
 *
 * Normative meanings:
 * - `resolved` — Padrón can demonstrate the effective identity at
 *   `effective_at`. Determinism: last version in force at close of that day.
 *   There is no `ambiguous` state.
 * - `not_found` — the entity did not exist at `effective_at` (created later)
 *   or does not exist.
 * - `insufficient_history` — the entity exists but Padrón cannot demonstrate
 *   which version applied on that date. Non-conclusive result, not an error
 *   code.
 *
 * `entity_version` is non-null only when `resolution === "resolved"`.
 *
 * Bootstrap: an entity with `entity_version == 1` and `created_at <=
 * effective_at` resolves `resolved` with the current version.
 */
export interface TemporalIdentityResolution {
    resolution: "resolved" | "not_found" | "insufficient_history";
    /** The consulted `identity_date` (ISO-8601 date). */
    effective_at: string;
    /** Effective version; non-null only when `resolution` is `resolved`. */
    entity_version: number | null;
}
//# sourceMappingURL=temporal-identity.d.ts.map