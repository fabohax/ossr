import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

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
    ],
    githubUrl: 'https://github.com/OSSR-protocol',
    themeSwitch: { enabled: false },
  };
}
