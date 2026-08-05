import rawCatalog from '@/data/catalog.json'
import type { Product } from './types'

export const products = rawCatalog as unknown as Product[]

export const priceBounds: [number, number] = products.reduce<[number, number]>(
  ([min, max], product) => [Math.min(min, product.price), Math.max(max, product.price)],
  [Infinity, -Infinity]
)

export const categories = [...new Set(products.map(product => product.categoryKey))].sort()

export const brands = [...new Set(products.map(product => product.brand))].sort()

export const categoryLabels = new Map(products.map(product => [product.categoryKey, product.category]))

export const productsById = new Map(products.map(product => [product.id, product]))

export function findProduct(id: string): Product | undefined {
  return productsById.get(id)
}
