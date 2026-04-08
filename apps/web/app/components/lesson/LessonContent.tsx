import ReactMarkdown from "react-markdown";

interface LessonContentProps {
  content: string;
}

/**
 * Renders AI-generated Markdown lesson content safely via react-markdown.
 * No dangerouslySetInnerHTML — all output is sanitized through the React tree.
 *
 * Max width: 680px on desktop (centered), full-width with 24px padding on mobile.
 */
export function LessonContent({ content }: LessonContentProps) {
  return (
    <div className="max-w-[680px] mx-auto px-6 py-4">
      <ReactMarkdown
        components={{
          h2: ({ children }) => (
            <h2 className="text-xl font-semibold mt-6 mb-3 leading-snug">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="text-base font-semibold mt-4 mb-2 leading-snug">
              {children}
            </h3>
          ),
          p: ({ children }) => (
            <p className="text-base leading-relaxed mb-4">{children}</p>
          ),
          ul: ({ children }) => (
            <ul className="list-disc pl-6 mb-4 space-y-1">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="list-decimal pl-6 mb-4 space-y-1">{children}</ol>
          ),
          li: ({ children }) => (
            <li className="text-base leading-relaxed">{children}</li>
          ),
          code: ({ children, className }) => {
            // Block code (inside <pre>) vs inline code
            const isInline = !className;
            if (isInline) {
              return (
                <code className="bg-card px-1 py-0.5 rounded text-sm font-mono">
                  {children}
                </code>
              );
            }
            return (
              <code className={`text-sm font-mono ${className ?? ""}`}>
                {children}
              </code>
            );
          },
          pre: ({ children }) => (
            <pre className="bg-card p-4 rounded-lg overflow-x-auto mb-4 text-sm">
              {children}
            </pre>
          ),
          blockquote: ({ children }) => (
            <blockquote className="border-l-4 border-border pl-4 my-4 text-muted-foreground italic">
              {children}
            </blockquote>
          ),
          strong: ({ children }) => (
            <strong className="font-semibold">{children}</strong>
          ),
          em: ({ children }) => <em className="italic">{children}</em>,
          hr: () => <hr className="border-border my-6" />,
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
