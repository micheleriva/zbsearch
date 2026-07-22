import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { appName, gitConfig } from './shared';
import { ZBSearchIcon } from '@/components/icons/zbsearch';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      // JSX supported
      title: (
        <span className="inline-flex items-center gap-2">
          <ZBSearchIcon className="size-5 object-contain" />
          {appName}
        </span>
      ),
    },
    links: [
      {
        text: 'Docs',
        url: '/docs/zbsearch',
        active: 'nested-url',
      },
      {
        text: 'Blog',
        url: '/blog',
        active: 'url',
      },
    ],
    githubUrl: `https://github.com/${gitConfig.user}/${gitConfig.repo}`,
  };
}
