// The renderer imports its stylesheet for its side effect; Vite resolves it,
// TypeScript does not. TS 7 turns `noUncheckedSideEffectImports` on by default,
// so the import needs a declaration to stay a checked one.
declare module "*.css";
