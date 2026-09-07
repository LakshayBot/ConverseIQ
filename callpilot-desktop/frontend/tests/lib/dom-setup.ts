// DOM environment for bun:test component/hook tests.
// Loaded via bunfig.toml [test].preload so it runs BEFORE any test module
// graph (bun's cross-file module evaluation order is otherwise
// nondeterministic, and @testing-library's `screen` binds `document.body`
// at module-eval time).
// bun:test has no DOM by default - register happy-dom globals and mark the
// environment as React-act-compatible so @testing-library/react works.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!(globalThis as any).__callpilotDomRegistered) {
  (globalThis as any).__callpilotDomRegistered = true;
  GlobalRegistrator.register();
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
}
