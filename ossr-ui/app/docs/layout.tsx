import type { ReactNode } from 'react';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout
      tree={{
        ...source.pageTree,
        children: [
          ...source.pageTree.children,
          { type: 'separator' },
          { type: 'page', name: 'Main Page', url: '/' },
          { type: 'page', name: 'x402', url: '/docs/x402' },
          { type: 'page', name: 'Developers', url: '/developers' },
          { type: 'page', name: 'Operators', url: '/operators' },
        ],
      }}
      {...baseOptions()}
      sidebar={{ collapsible: true }}
      containerProps={{ className: 'text-sm' }}
    >
      {children}
    </DocsLayout>
  );
}
