import hljs from "highlight.js/lib/core";
import goLang from "highlight.js/lib/languages/go";
import jsLang from "highlight.js/lib/languages/javascript";
import pyLang from "highlight.js/lib/languages/python";
import tsLang from "highlight.js/lib/languages/typescript";
import { useMemo } from "react";
import "highlight.js/styles/atom-one-dark.min.css";

hljs.registerLanguage("typescript", tsLang);
hljs.registerLanguage("javascript", jsLang);
hljs.registerLanguage("go", goLang);
hljs.registerLanguage("python", pyLang);

const EXT: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  go: "go",
  py: "python",
};

function langOf(path: string): string {
  const ext = path.split(".").pop() ?? "";
  return EXT[ext] ?? "";
}

/**
 * Syntax-highlighted code display (highlight.js, atom-one-dark over the jint dark theme).
 * Synchronous highlight; a failed/unregistered language falls back to escaped plain text.
 */
export function CodeBlock({ code, path }: { code: string; path: string }) {
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
