import type { ImgHTMLAttributes } from 'react';

/** Official Astro Starlight logo - `/public/icons/starlight.svg` */
export function StarlightIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { className, ...rest } = props;
  return (
    <img
      src="/icons/starlight.svg"
      alt=""
      aria-hidden
      className={className ?? 'size-full object-contain'}
      {...rest}
    />
  );
}
