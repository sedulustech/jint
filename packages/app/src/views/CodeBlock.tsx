import hljs from "highlight.js/lib/core";
import cLang from "highlight.js/lib/languages/c";
import cppLang from "highlight.js/lib/languages/cpp";
import cssLang from "highlight.js/lib/languages/css";
import goLang from "highlight.js/lib/languages/go";
import jsLang from "highlight.js/lib/languages/javascript";
import phpLang from "highlight.js/lib/languages/php";
import pyLang from "highlight.js/lib/languages/python";
import tsLang from "highlight.js/lib/languages/typescript";
import xmlLang from "highlight.js/lib/languages/xml";
import { lazy, Suspense, useMemo } from "react";
import "highlight.js/styles/atom-one-dark.min.css";

// markdown rendering (remark, rehype and its own highlight pack) loads only when a markdown
// element is opened: it is most of the UI bundle, and most runs never show one
const MarkdownBlock = lazy(() =>
  import("./MarkdownBlock").then((m) => ({ default: m.MarkdownBlock })),
);

hljs.registerLanguage("typescript", tsLang);
hljs.registerLanguage("javascript", jsLang);
// the JSX in tsx/jsx highlights as xml: the typescript grammar hands its tags to this sublanguage
hljs.registerLanguage("xml", xmlLang);
hljs.registerLanguage("go", goLang);
hljs.registerLanguage("python", pyLang);
hljs.registerLanguage("c", cLang);
hljs.registerLanguage("cpp", cppLang);
hljs.registerLanguage("css", cssLang);
hljs.registerLanguage("php", phpLang);

// the extensions jint's grammars parse, plus plain js
const EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  go: "go",
  py: "python",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  css: "css",
  php: "php",
};

function langOf(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return EXT[ext] ?? "";
}

/**
 * Syntax-highlighted code display (highlight.js, atom-one-dark over the jint dark theme); markdown
 * renders formatted instead. Synchronous highlight; a failed/unregistered language falls back to
 * escaped plain text.
 */
export function CodeBlock({ code, path }: { code: string; path: string }) {
  if (path.endsWith(".md")) {
    return (
      <Suspense fallback={<HighlightedCode code={code} path={path} />}>
        <MarkdownBlock source={code} />
      </Suspense>
    );
  }
  return <HighlightedCode code={code} path={path} />;
}

function HighlightedCode({ code, path }: { code: string; path: string }) {
  const html = useMemo(() => {
    const lang = langOf(path);
    try {
      return lang ? hljs.highlight(code, { language: lang }).value : hljs.highlightAuto(code).value;
    } catch {
      return code.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    }
  }, [code, path]);
  return (
    <pre className="hljs overflow-auto bg-transparent p-inner text-body leading-snug">
      <code dangerouslySetInnerHTML={{ __html: html }} />
    </pre>
  );
}
