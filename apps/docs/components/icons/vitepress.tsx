import type { ImgHTMLAttributes } from 'react'

/** Official VitePress logo - `/public/icons/vitepress.svg` */
export function VitePressIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { className, ...rest } = props
  return (
    <img src="/icons/vitepress.svg" alt="" aria-hidden className={className ?? 'size-full object-contain'} {...rest} />
  )
}
