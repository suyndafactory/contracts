/**
 * Module manifests — canonical rows live in data/manifests/*.json.
 * Foundation (and commercial modules) consume these for function grants.
 */
export interface ManifestFunction {
    function_key: string;
    nombre: string;
    descripcion: string;
    autorizada_por_canal: boolean;
    orden: number;
    /**
     * 6.2 — vocabulario único con atributos, no listas paralelas: la misma
     * function_key que compone un rol de membresía (roles[].functions) puede
     * también ser tilde de mandato. `delegable` gobierna eso. `cobrable` (mapeo
     * a una MeteredOperation) es la extensión futura anotada, NO ejecutada acá
     * — ver design-mandatos-capa1.md D5 en suynda-foundation.
     */
    delegable: boolean;
    /**
     * Dimensión de alcance declarada por el módulo — OPACA para la plataforma.
     * Ausente o null ⇒ función sin alcance (todas las de compra). String no
     * vacío ⇒ función con alcance: Foundation almacena y round-tripea refs;
     * SOLO el módulo interpreta el valor contra su propio catálogo (Lab:
     * "departamento" contra sus Departments). Sin enum global a propósito —
     * una dimensión nueva de un módulo futuro no exige release de contracts.
     * Prohibidos los strings mágicos ("*", "all", ""): lo hace cumplir el
     * verificador acá y Foundation re-valida al sembrar.
     * V1: una función con scope_type no puede ser delegable ni componer roles.
     */
    scope_type?: string | null;
}
export interface ManifestRole {
    role_key: string;
    nombre: string;
    orden: number;
    functions: string[];
}
/**
 * Un perfil precargado de mandato (ADR 003 dec. 5: "los tipos de mandato
 * que entiende" un módulo) — punto de partida ajustable, nunca jaula
 * (producto-mandatos.md Rev 3 §2). `function_keys` sólo puede listar
 * function_keys con `delegable: true` en `functions` — Foundation lo valida
 * al sembrar (falla el arranque si no, no siembra en silencio).
 */
export interface ManifestMandateProfile {
    profile_key: string;
    nombre: string;
    orden: number;
    function_keys: string[];
}
/**
 * Preset de permisos de MIEMBRO para /equipo — preselección de tildes,
 * JAMÁS fuente de autorización: no entra a la resolución efectiva, no se
 * persiste el preset elegido (el rótulo se deriva por igualdad de conjunto),
 * solo se escriben member_module_grants. A diferencia de
 * ManifestMandateProfile (delegable-only, cross-org), un preset PUEDE
 * incluir funciones no delegables y con scope — el scope se asigna aparte,
 * nunca viaja en el preset. Plan de Integración Canónica v1.1 §4.
 */
export interface ManifestPermissionPreset {
    preset_key: string;
    nombre: string;
    orden: number;
    functions: string[];
}
export interface ModuleManifest {
    module_key: string;
    manifest_version: number;
    functions: ManifestFunction[];
    roles: ManifestRole[];
    role_grant_matrix: Record<string, string[]>;
    /** 6.2 — perfiles de mandato precargados. Ver ManifestMandateProfile. */
    mandate_types: ManifestMandateProfile[];
    /** Presets de UX para tildes de miembro. Ausente = el módulo no declara presets. */
    permission_presets?: ManifestPermissionPreset[];
}
export declare const COMPRA_MANIFEST: ModuleManifest;
export declare const LAB_MANIFEST: ModuleManifest;
export declare const MANIFESTS: readonly ModuleManifest[];
export declare function manifestByModuleKey(moduleKey: string): ModuleManifest | undefined;
//# sourceMappingURL=manifests.d.ts.map