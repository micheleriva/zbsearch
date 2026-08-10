/**
 * Builds the demo product catalog.
 *
 * Pulls the DummyJSON product dataset, downloads every thumbnail into
 * `public/products` and writes a flattened catalog to `data/catalog.json`, so the
 * demo runs entirely offline once generated.
 *
 * Usage: node scripts/build-catalog.mjs
 */

import { mkdir, readdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const imagesDir = join(root, 'public', 'products')
const dataDir = join(root, 'data')

const SOURCE = 'https://dummyjson.com/products?limit=0'
const CONCURRENCY = 12

const CATEGORY_LABELS = {
  beauty: 'Beauty',
  fragrances: 'Fragrances',
  furniture: 'Furniture',
  groceries: 'Groceries',
  'home-decoration': 'Home Decoration',
  'kitchen-accessories': 'Kitchen Accessories',
  laptops: 'Laptops',
  'mens-shirts': 'Men Shirts',
  'mens-shoes': 'Men Shoes',
  'mens-watches': 'Men Watches',
  'mobile-accessories': 'Mobile Accessories',
  motorcycle: 'Motorcycle',
  'skin-care': 'Skin Care',
  smartphones: 'Smartphones',
  'sports-accessories': 'Sports Accessories',
  sunglasses: 'Sunglasses',
  tablets: 'Tablets',
  tops: 'Tops',
  vehicle: 'Vehicle',
  'womens-bags': 'Women Bags',
  'womens-dresses': 'Women Dresses',
  'womens-jewellery': 'Women Jewellery',
  'womens-shoes': 'Women Shoes',
  'womens-watches': 'Women Watches'
}

function labelize(slug) {
  return (
    CATEGORY_LABELS[slug] ??
    slug
      .split('-')
      .map((word) => word[0].toUpperCase() + word.slice(1))
      .join(' ')
  )
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

async function downloadImage(url, file, existing) {
  if (existing.has(file)) {
    return
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText} for ${url}`)
  }

  await writeFile(join(imagesDir, file), Buffer.from(await response.arrayBuffer()))
}

async function runPool(items, worker) {
  const queue = items.slice()
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    let item = queue.shift()

    while (item !== undefined) {
      await worker(item)
      item = queue.shift()
    }
  })

  await Promise.all(workers)
}

async function main() {
  await mkdir(imagesDir, { recursive: true })
  await mkdir(dataDir, { recursive: true })

  console.log(`Fetching ${SOURCE}`)
  const response = await fetch(SOURCE)

  if (!response.ok) {
    throw new Error(`Cannot fetch the dataset: ${response.status} ${response.statusText}`)
  }

  const { products } = await response.json()
  console.log(`Got ${products.length} products`)

  const existing = new Set(await readdir(imagesDir))
  const downloads = []

  const catalog = products.map((product) => {
    const slug = product.thumbnail.split('/').at(-2)
    const file = `${slug}.webp`
    downloads.push({ url: product.thumbnail, file })

    const price = round(product.price * (1 - product.discountPercentage / 100))
    // A good third of the dataset (groceries, kitchen accessories…) is genuinely
    // brandless. Left empty rather than invented, so it drops out of the facet.
    const brand = product.brand?.trim() ?? ''

    return {
      id: String(product.id),
      sku: product.sku,
      title: product.title,
      description: product.description,
      brand,
      brandKey: brand,
      category: labelize(product.category),
      categoryKey: product.category,
      tags: product.tags,
      price,
      listPrice: product.price,
      discount: round(product.discountPercentage, 1),
      rating: round(product.rating, 2),
      reviews: product.reviews?.length ?? 0,
      stock: product.stock,
      inStock: product.availabilityStatus !== 'Out of Stock',
      availability: product.availabilityStatus,
      shipping: product.shippingInformation,
      warranty: product.warrantyInformation,
      returnPolicy: product.returnPolicy,
      image: `/products/${file}`
    }
  })

  let done = 0
  await runPool(downloads, async ({ url, file }) => {
    await downloadImage(url, file, existing)
    done += 1

    if (done % 25 === 0) {
      console.log(`  ${done}/${downloads.length} images`)
    }
  })

  await writeFile(join(dataDir, 'catalog.json'), `${JSON.stringify(catalog, null, 2)}\n`)

  console.log(`Wrote ${catalog.length} products to data/catalog.json`)
  console.log(`Images in public/products (${(await readdir(imagesDir)).length} files)`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
