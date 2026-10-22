import Markdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

/**
 * Each markdown element styled where it is declared: the rendered source reads at the panel's body
 * size, headings by weight rather than size, so a section reads as part of the result panel.
 */
const COMPONENTS: Components = {
  h1: ({ children }) => <h1 className="font-bold">{children}</h1>,
  h2: ({ children }) => <h2 className="font-bold">{children}</h2>,
  h3: ({ children }) => <h3 className="font-bold">{children}</h3>,
  h4: ({ children }) => <h4 className="font-bold">{children}</h4>,
  h5: ({ children }) => <h5 className="font-bold">{children}</h5>,
  h6: ({ children }) => <h6 className="font-bold">{children}</h6>,
  ul: ({ children }) => <ul className="list-disc space-y-related pl-indent">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal space-y-related pl-indent">{children}</ol>,
  a: ({ children, href }) => (
    <a href={href} className="underline" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-border pl-siblings text-muted-foreground">
      {children}
    </blockquote>
  ),
  // a fenced block is one box: its code drops both the inline-code chip and the highlight theme's
  // own padding and background (the theme's selector outranks a plain override)
  pre: ({ children }) => (
    <pre className="overflow-auto rounded-xs bg-background p-inner [&>code]:bg-transparent! [&>code]:p-0!">
      {children}
    </pre>
  ),
  code: ({ children, className }) => (
    <code className={`rounded-xs bg-muted px-chip-x ${className ?? ""}`}>{children}</code>
  ),
  table: ({ children }) => <table className="border-collapse">{children}</table>,
  th: ({ children }) => (
    <th className="border border-border px-cell-x py-cell-y text-left font-bold">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-cell-x py-cell-y">{children}</td>,
  hr: () => <hr className="border-border" />,
};

/**
 * Markdown source rendered as formatted text (remark + rehype), fenced code highlighted with the
 * same highlight.js theme as source files. Raw HTML in the source stays text: the source is the
 * measured repository's, never trusted markup.
 */
export function MarkdownBlock({ source }: { source: string }) {
  return (
    <div className="space-y-siblings p-inner text-body text-foreground">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={COMPONENTS}
      >
        {source}
      </Markdown>
    </div>
  );
}
