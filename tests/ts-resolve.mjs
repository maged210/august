// Test-only ESM resolve shim (zero dependencies, Node built-ins only).
//
// The app's source uses extensionless relative imports ("./dates", "./options"),
// which Next/tsc resolve via bundler module resolution. Node's native test runner
// (with TypeScript type-stripping) does NOT rewrite specifiers, so a runtime value
// import of "./dates" fails with ERR_MODULE_NOT_FOUND. This in-thread hook retries an
// unresolved relative specifier with a ".ts" extension so the whole lib/intel tree is
// unit-testable without changing the source or adding a test framework.
//
// Usage: node --import ./tests/ts-resolve.mjs --test tests/intel.test.ts
import { registerHooks } from "node:module";

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (err) {
      const relative = specifier.startsWith("./") || specifier.startsWith("../");
      const hasExt = /\.[mc]?[jt]s$/.test(specifier);
      if (relative && !hasExt) return nextResolve(`${specifier}.ts`, context);
      throw err;
    }
  },
});
