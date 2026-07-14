import type { TOCItemType } from 'fumadocs-core/toc';
import type { MDXContent } from 'mdx/types';

export interface BlogPostData {
  title: string;
  description?: string;
  author: string;
  date: Date;
  body: MDXContent;
  toc: TOCItemType[];
}

export function asBlogPostData(data: unknown): BlogPostData {
  return data as BlogPostData;
}
