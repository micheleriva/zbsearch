import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { gitConfig } from './shared';
import { Logo } from '@/components/logo';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo className="group/logo" />,
    },
    links: [
      {
        text: 'Docs',
        url: '/docs/zbsearch',
        active: 'nested-url',
      },
      {
        text: 'Benchmarks',
        url: '/benchmarks',
        active: 'url',
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
