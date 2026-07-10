import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import { Iframe } from '@/lib/components/iframe';

export function getMDXComponents(components?: MDXComponents) {
  return {
    ...defaultMdxComponents,
    Iframe,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;

declare global {
  type MDXProvidedComponents = ReturnType<typeof getMDXComponents>;
}
