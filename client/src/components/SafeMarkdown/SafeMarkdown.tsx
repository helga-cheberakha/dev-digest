/* SafeMarkdown.tsx — sanitized markdown renderer for untrusted repo document content.
   Uses react-markdown without rehype-raw (raw HTML blocks are inert by default).
   Additionally strips javascript: and data: hrefs from links (AC-21). */
import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function isSafeHref(href: string | undefined | null): boolean {
  if (!href) return false;
  const lower = href.trim().toLowerCase();
  return !lower.startsWith("javascript:") && !lower.startsWith("data:");
}

export function SafeMarkdown({ content }: { content: string }) {
  return (
    <div style={{ fontSize: "inherit", lineHeight: 1.55, color: "var(--text-primary)" }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          /* Sanitize links: replace javascript:/data: hrefs with inert spans (AC-21). */
          a: ({ children, href }) =>
            isSafeHref(href) ? (
              <a
                href={href}
                style={{ color: "var(--accent-text)", textDecoration: "underline" }}
                rel="noopener noreferrer"
              >
                {children}
              </a>
            ) : (
              <span style={{ color: "var(--text-muted)" }}>{children}</span>
            ),
          p: ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
          pre: ({ children }) => (
            <pre
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
            const isBlock =
              !!className || (typeof children === "string" && children.endsWith("\n"));
            if (isBlock)
              return (
                <code
                  style={{ fontFamily: "monospace", fontSize: "0.92em" }}
                  className={className}
                >
                  {children}
                </code>
              );
            return (
              <code
                style={{
                  fontFamily: "monospace",
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
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
