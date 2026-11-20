/**
 * Memory-leak regression suite (fleet standard).
 *
 * List every model/view object that links Properties, adds listeners, or owns child
 * nodes, with a factory that builds a fresh instance. The shared harness in
 * tests/helpers/memoryLeak.ts (template-owned) checks that each one is garbage
 * collected after dispose() and leaves no survivors across repeated cycles
 * (idempotentDispose: true also checks a second dispose()). Add sim-specific leak
 * tests below using forceGC().
 */

// seed:leak-imports:start
import { TimeModel } from "../src/common/TimeModel.js";
// seed:leak-imports:end
import { describeDisposalLeaks } from "./helpers/memoryLeak.js";

// seed:leak-cases:start
describeDisposalLeaks([{ name: "TimeModel", create: () => new TimeModel(), idempotentDispose: true }]);
// seed:leak-cases:end
