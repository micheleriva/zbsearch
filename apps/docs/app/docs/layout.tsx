import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsSiteLinks } from '@/components/layout/docs-site-links';
import { baseOptions } from '@/lib/layout.shared';

export default function Layout({ children }: LayoutProps<'/docs'>) {
  return (
    <DocsLayout
      {...baseOptions()}
      // One compact strip instead of three full-width rows. `githubUrl` from
      // baseOptions still contributes its icon item to the sidebar footer.
      links={[{ type: 'custom', children: <DocsSiteLinks /> }]}
      tree={source.getPageTree()}
      tabs={{
        // The tab icon is the ZBSearch mark, which the lockup two rows above
        // already shows; drop it and let the title carry the switcher.
        transform: (option) => ({ ...option, description: undefined, icon: undefined }),
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
    >
      {children}
    </DocsLayout>
  );
}
