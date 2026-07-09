// Web platforms don't have process. React-Native doesn't have process.emitWarning.
const warn = globalThis.process?.emitWarning ??
    function emitWarning(message, options) {
        console.warn(`[WARNING] [${options.code}] ${message}`);
    };
export {};
//# sourceMappingURL=sync-blocking-checker.js.map