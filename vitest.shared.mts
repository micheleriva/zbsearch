import type { ViteUserConfig } from 'vitest/config'

const shared: ViteUserConfig = {
  test: {
    include: ['test?(s)/**/*.test.?(c|m)[jt]s?(x)'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/*.spec.ts',
      '**/test?(s)/ci/playwright/**'
    ],
    testTimeout: 120_000
  }
}

export default shared
