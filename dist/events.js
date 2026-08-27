/**
 * Event catalog — noun.verb_past, English, reference-only.
 * Canonical rows: data/events.json.
 *
 * Purchase post-approval lifecycle (Núcleo v0.9.0 / MC-04, CC-06) — shared
 * semantics for Compra (emitter) and Núcleo (consumer). Envelope stays
 * reference-only (`ref.id` + `entity_version`); consumers full-state re-pull.
 *
 * For one purchase aggregate (`ref.id`), `entity_version` is monotonic across
 * ALL of its events:
 * - `purchase.approved` first time = initial current approved state. Pull.
 * - `purchase.approved` re-emitted with greater `entity_version` =
 *   correction/replacement of the approved state. Full re-pull; never an
 *   accounting delta in the event.
 * - `purchase.voided` = previously approved state that is no longer current,
 *   with no successor current approved state. Re-pull; restatement in Núcleo.
 * - `purchase.rejected` = pre-approval rejection only. FORBIDDEN on an
 *   aggregate that was ever approved. No accounting consequence.
 *
 * Silent post-approval mutation of economic state is forbidden: every such
 * change MUST emit re-`approved` or `voided`. Compra owns the approved
 * normalized economic snapshot.
 */
import eventsData from "../data/events.json" with { type: "json" };
export const EVENTS = eventsData;
export const EVENT_TYPES = EVENTS.map((e) => e.type);
//# sourceMappingURL=events.js.map