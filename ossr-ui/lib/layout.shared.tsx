import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { DocumentDownload } from 'iconsax-reactjs';
import { Github, House, Radio } from 'lucide-react';
import { nostrProfileUrl } from './social';

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <span className="font-semibold tracking-tight">OSSR <span className="text-fd-muted-foreground">Docs</span></span>,
      url: '/docs',
    },
    links: [
      {
        type: 'icon',
        url: '/',
        text: 'Home',
        label: 'Home',
        icon: <House className="size-4" />,
      },
      {
        type: 'icon',
        url: nostrProfileUrl,
        text: 'Nostr',
        label: 'Nostr',
        icon: <Radio className="size-4" />,
        external: true,
      },
      {
        type: 'icon',
        url: 'https://github.com/ossr-protocol',
        text: 'GitHub',
        label: 'GitHub',
        icon: <Github className="size-4" />,
        external: true,
      },
      {
        type: 'icon',
        url: '/docs/download',
        text: 'Download documentation as PDF',
        label: 'Download documentation as PDF',
        icon: <DocumentDownload className="size-5" variant="Linear" />,
      },
    ],
    themeSwitch: { enabled: false },
  };
}
