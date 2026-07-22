import type { ImgHTMLAttributes } from 'react';

/** Official ZBSearch logo - `/public/icons/zbsearch.svg` */
export function ZBSearchIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { className, ...rest } = props;
  return (
    <img
      src="/icons/zbsearch.svg"
      alt=""
      aria-hidden
      className={className ?? 'size-full object-contain'}
      {...rest}
    />
  );
}
