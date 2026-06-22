import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Markdown renderer (replaces prototype mdLite). Inline + GFM. */
export function Markdown({ children }: { children?: string | null }) {
  if (!children) return null;
  return (
    <div className="dd-md" style={{ fontSize: "inherit", lineHeight: 1.55 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          strong: ({ children }) => (
            <strong style={{ fontWeight: 650, color: "var(--text-primary)" }}>{children}</strong>
          ),
          pre: ({ children }) => (
            <pre
              className="mono"
              style={{
                fontSize: "0.92em",
                padding: "8px 12px",
                borderRadius: 4,
                background: "var(--bg-hover)",
                overflowX: "auto",
                whiteSpace: "pre",
                margin: "0 0 10px",
              }}
            >
              {children}
            </pre>
          ),
          code: ({ children, className }) => {
            // Block code (inside pre) has a language className or trailing newline
            const isBlock =
              !!className || (typeof children === "string" && children.endsWith("\n"));
            if (isBlock) return <code className={`mono ${className ?? ""}`}>{children}</code>;
            return (
              <code
                className="mono"
                style={{
                  fontSize: "0.92em",
                  padding: "1px 6px",
                  borderRadius: 4,
                  background: "var(--bg-hover)",
                  color: "var(--accent-text)",
                }}
              >
                {children}
              </code>
            );
          },
          a: ({ children, href }) => (
            <a href={href} style={{ color: "var(--accent-text)", textDecoration: "underline" }}>
              {children}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
