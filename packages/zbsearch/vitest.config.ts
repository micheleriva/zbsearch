import { defineConfig } from 'vitest/config'
import shared from '../../vitest.shared.mjs'

export default defineConfig({
  ...shared,
  test: {
    ...shared.test,
    include: ['tests/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**'],
      exclude: ['src/cjs/**'],
      thresholds: { branches: 75, functions: 80, lines: 80, statements: 80 }
    }
  }
})
