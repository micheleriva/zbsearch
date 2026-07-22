import { createElement, type ComponentType, type ReactNode } from 'react';
import { icons } from 'lucide-react';
import type { LoaderPlugin } from 'fumadocs-core/source';

import { CloudflareIcon } from '@/components/icons/cloudflare';
import { ZBSearchIcon } from '@/components/icons/zbsearch';

const customIcons: Record<string, ComponentType> = {
  Cloudflare: CloudflareIcon,
  ZBSearch: ZBSearchIcon,
};

function resolveIcon(icon?: string): ReactNode {
  if (!icon) return;

  const Custom = customIcons[icon];
  if (Custom) return createElement(Custom);

  const Lucide = icons[icon as keyof typeof icons];
  if (Lucide) return createElement(Lucide);

  console.warn(`[docs-icons-plugin] Unknown icon: ${icon}`);
}

function iconPlugin(resolve: (icon?: string) => ReactNode): LoaderPlugin {
  function replaceIcon<T extends { icon?: ReactNode | string }>(node: T): T {
    if (node.icon === undefined || typeof node.icon === 'string') {
      node.icon = resolve(node.icon);
    }
    return node;
  }

  return {
    name: 'fumadocs:icon',
    transformPageTree: {
      file: replaceIcon,
      folder: replaceIcon,
      separator: replaceIcon,
    },
  };
}

/** Lucide icons + custom brand icons (e.g. Cloudflare). */
export function docsIconsPlugin(): LoaderPlugin {
  return iconPlugin(resolveIcon);
}
