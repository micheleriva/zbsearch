'use client';

import { useState } from 'react';
import Link from 'fumadocs-core/link';
import { useHomeLayout } from 'fumadocs-ui/layouts/home';
import { LinkItem } from 'fumadocs-ui/layouts/shared';
import type { LinkItemType } from 'fumadocs-ui/layouts/shared';
import { buttonVariants } from 'fumadocs-ui/components/ui/button';
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
  NavigationMenuViewport,
} from 'fumadocs-ui/components/ui/navigation-menu';
import { Menu } from 'lucide-react';
import { Logo } from '@/components/logo';
import { cn } from '@/lib/cn';
import { gitConfig, packageVersion } from '@/lib/shared';

/**
 * Home header, built on the vite/void(0) pattern: a solid bar whose bottom rule
 * runs edge to edge, with the lockup, navigation and version tag on the left
 * and search + utilities on the right. Everything sits on plain text - no
 * pills, no hover fills - so the accent colour is the only thing that moves.
 */
export function HomeHeader(props: React.ComponentProps<'header'>) {
  const { navItems, menuItems, slots } = useHomeLayout();
  const [openMenu, setOpenMenu] = useState('');

  const primary = navItems.filter((item) => !isSecondary(item));
  const secondary = navItems.filter(isSecondary);

  return (
    <NavigationMenu value={openMenu} onValueChange={setOpenMenu} asChild>
      <header
        id="nd-nav"
        {...props}
        className={cn('sticky top-0 z-40 h-20', props.className)}
      >
        <div
          className={cn(
            'border-b border-fd-border bg-fd-background',
            openMenu.length > 0 && 'shadow-lg md:shadow-none',
          )}
        >
          <NavigationMenuList
            className="mx-auto flex h-20 w-full max-w-[90rem] items-center gap-8 px-6"
            asChild
          >
            <nav>
              <Link
                href="/"
                className="group/logo shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-fd-ring"
              >
                <Logo />
              </Link>

              <ul className="flex flex-row items-center gap-7 max-md:hidden">
                {primary.map((item, i) => (
                  <NavItem key={i} item={item} />
                ))}
                <li>
                  <a
                    href={`https://github.com/${gitConfig.user}/${gitConfig.repo}/releases`}
                    target="_blank"
                    rel="noreferrer"
                    className="font-mono text-[0.8125rem] tracking-tight text-fd-muted-foreground transition-colors hover:text-fd-primary"
                  >
                    v{packageVersion}
                  </a>
                </li>
              </ul>

              <div className="ms-auto flex flex-row items-center gap-4 max-md:hidden">
                {slots.searchTrigger && (
                  <slots.searchTrigger.full
                    hideIfDisabled
                    className="h-9 w-40 rounded-lg border-0 bg-fd-muted px-3 hover:bg-fd-accent/60"
                  />
                )}
                <ul className="flex flex-row items-center gap-3 empty:hidden">
                  {secondary.map((item, i) => (
                    <NavItem key={i} item={item} />
                  ))}
                </ul>
                {slots.themeSwitch && <slots.themeSwitch />}
              </div>

              <div className="-me-2 ms-auto flex flex-row items-center gap-1 md:hidden">
                {slots.searchTrigger && (
                  <slots.searchTrigger.sm hideIfDisabled className="p-2" />
                )}
                <NavigationMenuItem asChild>
                  <div>
                    <NavigationMenuTrigger
                      aria-label="Toggle menu"
                      className={cn(
                        buttonVariants({ size: 'icon', color: 'ghost' }),
                        '[&_svg]:size-5',
                      )}
                      onPointerMove={(e) => e.preventDefault()}
                    >
                      <Menu />
                    </NavigationMenuTrigger>
                    <NavigationMenuContent className="mx-auto flex w-full max-w-[90rem] flex-col gap-1 px-6 pb-6">
                      {menuItems
                        .filter((item) => !isSecondary(item))
                        .map((item, i) => (
                          <MobileNavItem key={i} item={item} />
                        ))}
                      <div className="-ms-2 mt-4 flex flex-row items-center gap-3 border-t border-fd-border pt-4">
                        {menuItems.filter(isSecondary).map((item, i) => (
                          <MobileNavItem key={i} item={item} />
                        ))}
                        <div role="separator" className="flex-1" />
                        {slots.themeSwitch && <slots.themeSwitch />}
                      </div>
                    </NavigationMenuContent>
                  </div>
                </NavigationMenuItem>
              </div>
            </nav>
          </NavigationMenuList>
          <NavigationMenuViewport />
        </div>
      </header>
    </NavigationMenu>
  );
}

/** Plain text, full contrast; the accent is reserved for hover and active. */
const navLinkStyles =
  'inline-flex items-center gap-1.5 text-[0.9375rem] text-fd-foreground transition-colors hover:text-fd-primary data-[active=true]:text-fd-primary';

const iconLinkStyles =
  'inline-flex size-5 items-center justify-center text-fd-muted-foreground transition-colors hover:text-fd-foreground';

function NavItem({ item }: { item: LinkItemType }) {
  if (item.type === 'custom') return item.children;

  if (item.type === 'menu') {
    return (
      <NavigationMenuItem>
        <NavigationMenuTrigger className={navLinkStyles}>
          {item.url ? (
            <Link href={item.url} external={item.external}>
              {item.text}
            </Link>
          ) : (
            item.text
          )}
        </NavigationMenuTrigger>
        <NavigationMenuContent className="grid grid-cols-1 gap-px bg-fd-border md:grid-cols-2 lg:grid-cols-3">
          {item.items.map((child, i) =>
            child.type === 'custom' ? (
              <div key={i} className="bg-fd-background p-4">
                {child.children}
              </div>
            ) : (
              <NavigationMenuLink key={i} asChild>
                <Link
                  href={child.url}
                  external={child.external}
                  className="flex flex-col gap-2 bg-fd-background p-4 transition-colors hover:bg-fd-muted"
                >
                  {child.icon}
                  <p className="text-[0.9375rem]">{child.text}</p>
                  <p className="text-sm text-fd-muted-foreground empty:hidden">
                    {child.description}
                  </p>
                </Link>
              </NavigationMenuLink>
            ),
          )}
        </NavigationMenuContent>
      </NavigationMenuItem>
    );
  }

  return (
    <li>
      <NavigationMenuItem asChild>
        <NavigationMenuLink asChild>
          <LinkItem
            item={item}
            aria-label={item.type === 'icon' ? item.label : undefined}
            className={cn(
              item.type === 'icon' ? iconLinkStyles : navLinkStyles,
              '[&_svg]:size-5',
            )}
          >
            {item.type === 'icon' ? item.icon : item.text}
          </LinkItem>
        </NavigationMenuLink>
      </NavigationMenuItem>
    </li>
  );
}

function MobileNavItem({ item }: { item: LinkItemType }) {
  if (item.type === 'custom') return <div className="grid">{item.children}</div>;

  if (item.type === 'menu') {
    return (
      <div className="flex flex-col">
        <p className="mb-1 mt-2 font-mono text-xs uppercase tracking-wide text-fd-muted-foreground">
          {item.text}
        </p>
        {item.items.map((child, i) => (
          <MobileNavItem key={i} item={child} />
        ))}
      </div>
    );
  }

  return (
    <NavigationMenuLink asChild>
      <LinkItem
        item={item}
        aria-label={item.type === 'icon' ? item.label : undefined}
        className={cn(
          item.type === 'icon'
            ? cn(iconLinkStyles, 'mx-2')
            : 'py-2 text-[0.9375rem] text-fd-foreground transition-colors hover:text-fd-primary data-[active=true]:text-fd-primary',
          '[&_svg]:size-5',
        )}
      >
        {item.type === 'icon' ? item.icon : item.text}
      </LinkItem>
    </NavigationMenuLink>
  );
}

function isSecondary(item: LinkItemType) {
  if ('secondary' in item && item.secondary != null) return item.secondary;
  return item.type === 'icon';
}
