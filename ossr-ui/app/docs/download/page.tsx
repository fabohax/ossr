import type { Metadata } from 'next';
import { getMDXComponents } from '@/components/mdx';
import { source } from '@/lib/source';
import { AutoPrint } from './auto-print';

export const metadata: Metadata = {
  title: 'Download OSSR Documentation',
  description: 'Print or save all OSSR documentation as a PDF.',
};

export default function DownloadDocsPage() {
  const pages = source.getPages();

  return (
    <main className="docs-print-view">
      <AutoPrint />
      <header className="docs-print-cover">
        <h1>OSSR Documentation</h1>
        <p>Open Stacks Sponsor Relay</p>
      </header>
      {pages.map((page) => {
        const MDX = page.data.body;

        return (
          <article className="docs-print-section" key={page.url}>
            <h1>{page.data.title}</h1>
            {page.data.description ? <p className="docs-print-description">{page.data.description}</p> : null}
            <MDX
              components={getMDXComponents({
                iframe: ({ src, ...props }) => {
                  if (src?.includes('youtube.com') || src?.includes('youtu.be')) return null;
                  return <iframe src={src} {...props} />;
                },
              })}
            />
          </article>
        );
      })}
    </main>
  );
}
