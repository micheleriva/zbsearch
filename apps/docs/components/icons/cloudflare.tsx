import type { ImgHTMLAttributes } from 'react'

/** Official Cloudflare logo - `/public/icons/cloudflare.svg` */
export function CloudflareIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { className, ...rest } = props
  return (
    <img src="/icons/cloudflare.svg" alt="" aria-hidden className={className ?? 'size-full object-contain'} {...rest} />
  )
}
