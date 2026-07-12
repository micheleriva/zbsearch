import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      tree={source.getPageTree()}
      tabs={{
        transform: (option) => ({ ...option, description: undefined }),
      }}
      containerProps={{
        style: {
          gridTemplate: `"sidebar header toc"
"sidebar toc-popover toc"
"sidebar main toc" 1fr / var(--fd-sidebar-col) minmax(0, 1fr) var(--fd-toc-width)`,
        },
      }}
      sidebar={{
        className: '!items-stretch',
      }}
      {...baseOptions()}
    >
      {children}
    </DocsLayout>
  );
}
