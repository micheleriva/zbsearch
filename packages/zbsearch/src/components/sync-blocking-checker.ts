// Web platforms don't have process. React-Native doesn't have process.emitWarning.
const _warn =
  globalThis.process?.emitWarning ??
  function emitWarning(message: string, options: { code: string }) {
    console.warn(`[WARNING] [${options.code}] ${message}`)
  }
