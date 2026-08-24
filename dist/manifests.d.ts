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
     * D2 — dimensión de scope declarada por el módulo. Opaca para Foundation:
     * se almacena y se round-tripa; no se interpreta. Omitido / null → function
     * unscoped (todas las de Compra). String no vacío → scoped. No hay enum
     * global de scope types ni de Departamento en este paquete.
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
export interface ModuleManifest {
    module_key: string;
    manifest_version: number;
    functions: ManifestFunction[];
    roles: ManifestRole[];
    role_grant_matrix: Record<string, string[]>;
    /** 6.2 — perfiles de mandato precargados. Ver ManifestMandateProfile. */
    mandate_types: ManifestMandateProfile[];
}
export declare const COMPRA_MANIFEST: ModuleManifest;
export declare const LAB_MANIFEST: ModuleManifest;
export declare const MANIFESTS: readonly ModuleManifest[];
export declare function manifestByModuleKey(moduleKey: string): ModuleManifest | undefined;
//# sourceMappingURL=manifests.d.ts.map