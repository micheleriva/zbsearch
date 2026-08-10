import { defineConfig } from 'vitest/config'
import shared from '../../vitest.shared.mjs'

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    include: [],
    typecheck: { enabled: true, include: ['tests/type/*.test-d.ts'] }
  }
})
