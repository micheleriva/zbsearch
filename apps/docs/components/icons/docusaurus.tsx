import type { ImgHTMLAttributes } from 'react';

/** Official Docusaurus logo - `/public/icons/docusaurus.svg` */
export function DocusaurusIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
  const { className, ...rest } = props;
  return (
    <img
      src="/icons/docusaurus.svg"
      alt=""
      aria-hidden
      className={className ?? 'size-full object-contain'}
      {...rest}
    />
  );
}
