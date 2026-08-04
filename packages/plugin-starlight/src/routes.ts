import type { RouteOptions } from './options.js'

function stripLeadingSlash(path: string): string {
  return path.startsWith('/') ? path.slice(1) : path
}

function stripTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path
}

function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path : `${path}/`
}

export function slugToPathname(slug: string): string {
  if (slug === 'index' || slug === '' || slug === '/') {
    return '/'
  }

  const param = (slug.endsWith('/index') ? slug.slice(0, -6) : slug).normalize()

  return param ? `/${param}/` : '/'
}

export function createPathFormatter({ base, format, trailingSlash }: RouteOptions): (path: string) => string {
  const prefix = stripTrailingSlash(base)

  return (path) => {
    if (format === 'file') {
      const withoutSlash = stripTrailingSlash(stripLeadingSlash(path))

      return withoutSlash ? `${prefix}/${withoutSlash}.html` : `${prefix}/index.html`
    }

    const relative = stripLeadingSlash(path)
    const href = relative ? `${prefix}/${relative}` : `${prefix}/`

    if (href === '/') {
      return href
    }

    if (trailingSlash === 'always') {
      return ensureTrailingSlash(href)
    }

    if (trailingSlash === 'never') {
      return stripTrailingSlash(href) || '/'
    }

    return href
  }
}
