export interface Product {
  id: string
  sku: string
  title: string
  description: string
  brand: string
  /** Same value as `brand`, indexed as an `enum` so it can be filtered and faceted on. */
  brandKey: string
  category: string
  /** Same value as `category`, indexed as an `enum` so it can be filtered and faceted on. */
  categoryKey: string
  tags: string[]
  price: number
  listPrice: number
  discount: number
  rating: number
  reviews: number
  stock: number
  inStock: boolean
  availability: string
  shipping: string
  warranty: string
  returnPolicy: string
  image: string
}

export type SortKey = 'relevance' | 'price-asc' | 'price-desc' | 'rating' | 'discount'

export interface Boosts {
  title: number
  brand: number
  category: number
  tags: number
  description: number
}

export interface StoreFilters {
  categories: string[]
  brands: string[]
  price: [number, number]
  minRating: number
  inStockOnly: boolean
}

export interface EngineSettings {
  boosts: Boosts
  tolerance: number
  exact: boolean
  threshold: number
  pinningEnabled: boolean
}

export interface FacetBucket {
  value: string
  count: number
  selected: boolean
}
