import zlib from 'node:zlib'
import fs from 'node:fs'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { versions, schema } from './src/get-engines.js'
import { stopWordTokenizer, databaseSortConfig } from './src/benchmark-config.js'
import dataset from './src/dataset.json' with { type: 'json' }

const oramaPath = './bundle/orama.json'
const zbsearchPath = './bundle/zbsearch.json'

const dbOrama = orama.create({ schema, components: { tokenizer: stopWordTokenizer } })
const dbZBSearch = zbsearch.create({
  schema,
  components: { tokenizer: stopWordTokenizer },
  sort: databaseSortConfig
})

orama.insertMultiple(dbOrama, dataset, dataset.length)
zbsearch.insertMultiple(dbZBSearch, dataset, dataset.length)

fs.mkdirSync('./bundle', { recursive: true })
fs.writeFileSync(oramaPath, JSON.stringify(orama.save(dbOrama)))
fs.writeFileSync(zbsearchPath, JSON.stringify(zbsearch.save(dbZBSearch)))

fs.writeFileSync(oramaPath + '.gz', zlib.gzipSync(fs.readFileSync(oramaPath)))
fs.writeFileSync(zbsearchPath + '.gz', zlib.gzipSync(fs.readFileSync(zbsearchPath)))

const oramaSize = fs.statSync(oramaPath).size
const zbsearchSize = fs.statSync(zbsearchPath).size
const oramaGzipSize = fs.statSync(oramaPath + '.gz').size
const zbsearchGzipSize = fs.statSync(zbsearchPath + '.gz').size

console.log(`Orama ${versions.orama}`)
console.log(`  JSON: ${oramaSize} bytes`)
console.log(`  GZIP: ${oramaGzipSize} bytes`)
console.log(`ZBSearch ${versions.zbsearch}`)
console.log(`  JSON: ${zbsearchSize} bytes`)
console.log(`  GZIP: ${zbsearchGzipSize} bytes`)
