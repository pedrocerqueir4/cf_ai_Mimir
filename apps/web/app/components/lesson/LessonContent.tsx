import ReactMarkdown from "react-markdown";

interface LessonContentProps {
  content: string;
}

/**
 * Renders AI-generated Markdown lesson content safely via react-markdown.
 * No dangerouslySetInnerHTML — all output is sanitized through the React tree.
 *
 * Phase 06 Plan 03 — UI-SPEC § Lesson Reader: prose token-aligned (`body`
 * 16/1.5, `h2` 22/1.25/600/-0.005em, `h3` 18/1.3/500). Code blocks consume
 * `--bg-subtle`. Max-width 680px is owned by the parent route wrapper now.
 */
export function LessonContent({ content }: LessonContentProps) {
  return (
    <ReactMarkdown
      components={{
        h2: ({ children }) => (
          <h2 className="mt-6 mb-3 text-[22px] font-semibold leading-[1.25] -tracking-[0.005em] text-foreground">
            {children}
          </h2>
        ),
        h3: ({ children }) => (
          <h3 className="mt-4 mb-2 text-[18px] font-medium leading-[1.3] text-foreground">
            {children}
          </h3>
        ),
        p: ({ children }) => (
          <p className="mb-4 text-[16px] leading-[1.5] text-foreground">
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul className="mb-4 list-disc pl-6 space-y-1 text-[16px] leading-[1.5]">
            {children}
          </ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-4 list-decimal pl-6 space-y-1 text-[16px] leading-[1.5]">
            {children}
          </ol>
        ),
        li: ({ children }) => (
          <li className="text-[16px] leading-[1.5] text-foreground">
            {children}
          </li>
        ),
        code: ({ children, className }) => {
          // Block code (inside <pre>) vs inline code
          const isInline = !className;
          if (isInline) {
            return (
              <code className="rounded bg-[hsl(var(--bg-subtle))] px-1 py-0.5 text-[14px] font-mono">
                {children}
              </code>
            );
          }
          return (
            <code className={`text-[14px] font-mono ${className ?? ""}`}>
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="mb-4 overflow-x-auto rounded-lg bg-[hsl(var(--bg-subtle))] p-4 text-[14px]">
            {children}
          </pre>
        ),
        blockquote: ({ children }) => (
          <blockquote className="my-4 border-l-4 border-[hsl(var(--border))] pl-4 italic text-[hsl(var(--fg-muted))]">
            {children}
          </blockquote>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold">{children}</strong>
        ),
        em: ({ children }) => <em className="italic">{children}</em>,
        hr: () => <hr className="my-6 border-[hsl(var(--border))]" />,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
