import zlib from 'node:zlib'
import fs from 'node:fs'
import * as orama from '@orama/orama'
import * as zbsearch from 'zbsearch'
import { versions, insertMultiple, dbOrama, dbZBSearch } from './src/get-engines.js'

const oramaPath = './bundle/orama.json'
const zbsearchPath = './bundle/zbsearch.json'

insertMultiple.orama()
insertMultiple.zbsearch()

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
