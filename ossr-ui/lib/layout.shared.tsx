import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { nostrProfileUrl } from './social';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold tracking-tight">OSSR <span className="text-fd-muted-foreground">Docs</span></span>,
      url: '/docs',
    },
    links: [
      { text: 'Main page', url: '/' },
      { text: 'Developers', url: '/developers' },
      { text: 'Operators', url: '/operators' },
      { text: 'Nostr', url: nostrProfileUrl, external: true },
    ],
    githubUrl: 'https://github.com/OSSR-protocol',
    themeSwitch: { enabled: false },
  };
}
