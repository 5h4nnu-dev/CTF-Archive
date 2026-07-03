import { Calendar, ArrowRight } from "lucide-react";
import DifficultyBadge from "./DifficultyBadge";

export default function WriteupCard({ writeup, onClick }) {
  const { title, description, difficulty, tags, date } = writeup;

  return (
    <article className="writeup-card" onClick={() => onClick(writeup)}>
      <div className="card-header">
        <h2 className="card-title">{title}</h2>
        <DifficultyBadge difficulty={difficulty} />
      </div>
      <p className="card-description">{description}</p>
      <div className="card-footer">
        <div className="card-tags">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
        <div className="card-meta">
          <span className="card-date">
            <Calendar size={14} />
            {date}
          </span>
          <span className="card-read">
            Read <ArrowRight size={14} />
          </span>
        </div>
      </div>
    </article>
  );
}
