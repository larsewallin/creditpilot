import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import userGuide from "@/content/user-guide.md?raw";

/** "How severity works" -> "severity" style anchors: the first meaningful word of each heading. */
const ANCHORS: Record<string, string> = { "How severity works": "severity" };
const slug = (text: string) => ANCHORS[text] ?? text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const textOf = (children: unknown): string =>
  Array.isArray(children) ? children.map(textOf).join("") : typeof children === "string" ? children : "";

export default function About() {
  const { hash } = useLocation();
  useEffect(() => {
    if (hash) document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [hash]);
  return (
    <div className="space-y-6 pb-48">
      <div className="prose prose-base max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-hr:border-border">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{ h2: ({ children }) => <h2 id={slug(textOf(children))} className="scroll-mt-6">{children}</h2> }}
        >{userGuide}</ReactMarkdown>
      </div>
    </div>
  );
}
