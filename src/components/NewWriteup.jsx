import { useState } from "react";
import { ArrowLeft, Save, Download } from "lucide-react";

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane"];

const DEFAULT_TAGS = ["Web", "OSINT", "Privilege Escalation", "File Upload", "Reconnaissance", "Social Media", "Rejetto"];

function generateFrontmatter({ title, description, difficulty, tags, date }) {
  return `---
title: "${title}"
description: "${description}"
difficulty: "${difficulty}"
tags: [${tags.map((t) => `"${t}"`).join(", ")}]
date: "${date}"
---`;
}

function toSlug(title) {
  return title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

export default function NewWriteup({ onBack, onSave }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [difficulty, setDifficulty] = useState("Easy");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [tagsInput, setTagsInput] = useState("");
  const [content, setContent] = useState("");
  const [saved, setSaved] = useState(false);

  const tags = tagsInput
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);

  const handleSave = () => {
    if (!title || !description || !content) return;

    const frontmatter = generateFrontmatter({ title, description, difficulty, tags, date });
    const markdown = `${frontmatter}\n\n${content}`;

    const writeup = {
      title,
      description,
      difficulty,
      tags,
      date,
      content,
      slug: toSlug(title),
    };

    onSave(writeup, markdown);
    setSaved(true);
  };

  const handleDownload = () => {
    if (!title) return;
    const frontmatter = generateFrontmatter({ title, description, difficulty, tags, date });
    const markdown = `${frontmatter}\n\n${content}`;
    const blob = new Blob([markdown], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${toSlug(title)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (saved) {
    return (
      <div className="new-writeup">
        <div className="saved-notice">
          <h2>Writeup saved!</h2>
          <p>It appears in the writeup list. You can also download the markdown file to commit to the repo.</p>
          <div className="saved-actions">
            <button className="btn btn-primary" onClick={handleDownload}>
              <Download size={16} />
              Download .md file
            </button>
            <button className="btn btn-secondary" onClick={onBack}>
              Back to writeups
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="new-writeup">
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={18} />
        Back to writeups
      </button>

      <div className="form-header">
        <h1>New Writeup</h1>
        <p className="list-subtitle">Create a new challenge writeup</p>
      </div>

      <div className="writeup-form">
        <div className="form-row">
          <div className="form-group flex-1">
            <label htmlFor="title">Title</label>
            <input
              id="title"
              type="text"
              placeholder="e.g. Blueprint"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="difficulty">Difficulty</label>
            <select
              id="difficulty"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              {DIFFICULTIES.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="description">Description</label>
          <input
            id="description"
            type="text"
            placeholder="Brief description of the challenge"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="tags">Tags (comma-separated)</label>
          <input
            id="tags"
            type="text"
            placeholder={`e.g. ${DEFAULT_TAGS.slice(0, 3).join(", ")}`}
            value={tagsInput}
            onChange={(e) => setTagsInput(e.target.value)}
          />
          {tags.length > 0 && (
            <div className="form-tags">
              {tags.map((t) => (
                <span key={t} className="tag">{t}</span>
              ))}
            </div>
          )}
        </div>

        <div className="form-group">
          <label htmlFor="content">Writeup Content (Markdown)</label>
          <textarea
            id="content"
            placeholder="Write your writeup in markdown..."
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={18}
          />
        </div>

        <div className="form-actions">
          <button className="btn btn-primary" onClick={handleSave} disabled={!title || !description || !content}>
            <Save size={16} />
            Save Writeup
          </button>
          <button className="btn btn-secondary" onClick={handleDownload} disabled={!title}>
            <Download size={16} />
            Download .md
          </button>
        </div>
      </div>
    </div>
  );
}
