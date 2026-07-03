import { ArrowLeft, Calendar } from "lucide-react";
import ReactMarkdown from "react-markdown";
import DifficultyBadge from "./DifficultyBadge";

export default function WriteupDetail({ writeup, onBack }) {
  const { title, description, difficulty, tags, date, content } = writeup;

  return (
    <div className="writeup-detail">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        Back to writeups
      </button>

      <header className="detail-header">
        <h1>{title}</h1>
        <div className="detail-meta">
          <DifficultyBadge difficulty={difficulty} />
          <span className="detail-date">
            <Calendar size={15} />
            {date}
          </span>
        </div>
        <p className="detail-description">{description}</p>
        <div className="detail-tags">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      </header>

      <div className="detail-body markdown-body">
        <ReactMarkdown
          components={{
            code({ className, children, ...props }) {
              const isInline = !className;
              if (isInline) {
                return <code {...props}>{children}</code>;
              }
              return (
                <pre>
                  <code className={className} {...props}>
                    {children}
                  </code>
                </pre>
              );
            },
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}
