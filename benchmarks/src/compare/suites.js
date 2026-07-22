import { createRequire } from 'node:module'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { runPairComparisonSuites } from './pair-suites.js'

const require = createRequire(import.meta.url)

export const versions = {
  orama: require('@orama/orama/package.json').version,
  zbsearch: require('zbsearch/package.json').version
}

export function runComparisonSuites(options = {}) {
  const report = runPairComparisonSuites(
    {
      key: 'orama',
      label: 'Orama',
      version: versions.orama,
      lib: orama,
      entry: '@orama/orama',
      useSort: false
    },
    {
      key: 'zbsearch',
      label: 'ZBSearch',
      version: versions.zbsearch,
      lib: zbsearch,
      entry: 'zbsearch',
      useSort: true
    },
    options
  )

  return {
    ...report,
    versions
  }
}
