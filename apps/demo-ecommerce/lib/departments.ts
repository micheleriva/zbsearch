/**
 * Twenty-four catalog categories are too many for a shop nav, so they are grouped into
 * six departments. Picking one sets a `where` filter over every category it contains.
 */
export interface Department {
  slug: string
  label: string
  categories: string[]
}

export const departments: Department[] = [
  {
    slug: 'tech',
    label: 'Tech',
    categories: ['smartphones', 'laptops', 'tablets', 'mobile-accessories'],
  },
  {
    slug: 'beauty',
    label: 'Beauty',
    categories: ['beauty', 'fragrances', 'skin-care'],
  },
  {
    slug: 'women',
    label: 'Women',
    categories: [
      'womens-dresses',
      'tops',
      'womens-shoes',
      'womens-bags',
      'womens-jewellery',
      'womens-watches',
    ],
  },
  {
    slug: 'men',
    label: 'Men',
    categories: ['mens-shirts', 'mens-shoes', 'mens-watches'],
  },
  {
    slug: 'home',
    label: 'Home & Kitchen',
    categories: ['furniture', 'home-decoration', 'kitchen-accessories', 'groceries'],
  },
  {
    slug: 'sport',
    label: 'Sport & Auto',
    categories: ['sports-accessories', 'sunglasses', 'motorcycle', 'vehicle'],
  },
]

/** The department whose categories are exactly the current selection, if any. */
export function activeDepartment(selected: string[]): Department | undefined {
  if (selected.length === 0) {
    return undefined
  }

  return departments.find(
    department =>
      department.categories.length === selected.length &&
      department.categories.every(category => selected.includes(category))
  )
}
