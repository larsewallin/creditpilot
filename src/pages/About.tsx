import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import userGuide from "@/content/user-guide.md?raw";

export default function About() {
  return (
    <div className="space-y-6 pb-48">
      <div className="prose prose-base max-w-none text-foreground prose-headings:text-foreground prose-strong:text-foreground prose-a:text-primary prose-hr:border-border">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{userGuide}</ReactMarkdown>
      </div>
    </div>
  );
}
