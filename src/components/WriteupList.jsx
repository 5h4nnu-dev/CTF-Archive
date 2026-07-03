import { useState, useMemo } from "react";
import { Search, X } from "lucide-react";
import WriteupCard from "./WriteupCard";

const ALL_TAGS = ["Web", "OSINT", "Privilege Escalation", "File Upload", "Reconnaissance", "Social Media", "Rejetto"];

const DIFFICULTIES = ["Easy", "Medium", "Hard", "Insane"];

export default function WriteupList({ writeups, onSelect }) {
  const [search, setSearch] = useState("");
  const [activeDifficulty, setActiveDifficulty] = useState(null);
  const [activeTags, setActiveTags] = useState([]);

  const filtered = useMemo(() => {
    return writeups.filter((w) => {
      const q = search.toLowerCase();
      const matchesSearch =
        !q ||
        w.title.toLowerCase().includes(q) ||
        w.description.toLowerCase().includes(q) ||
        w.tags.some((t) => t.toLowerCase().includes(q));

      const matchesDifficulty = !activeDifficulty || w.difficulty === activeDifficulty;
      const matchesTags =
        activeTags.length === 0 || activeTags.every((t) => w.tags.includes(t));

      return matchesSearch && matchesDifficulty && matchesTags;
    });
  }, [writeups, search, activeDifficulty, activeTags]);

  const toggleTag = (tag) => {
    setActiveTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  };

  const clearFilters = () => {
    setSearch("");
    setActiveDifficulty(null);
    setActiveTags([]);
  };

  const hasFilters = search || activeDifficulty || activeTags.length > 0;

  return (
    <div className="writeup-list">
      <div className="list-header">
        <h1>Writeups</h1>
        <p className="list-subtitle">
          {writeups.length} challenge{writeups.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="search-bar">
        <Search size={18} className="search-icon" />
        <input
          type="text"
          placeholder="Search by name, description, or tag..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button className="search-clear" onClick={() => setSearch("")}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="filter-section">
        <div className="filter-group">
          <span className="filter-label">Difficulty</span>
          <div className="filter-chips">
            {DIFFICULTIES.map((d) => (
              <button
                key={d}
                className={`chip ${activeDifficulty === d ? "active" : ""}`}
                onClick={() =>
                  setActiveDifficulty((prev) => (prev === d ? null : d))
                }
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-group">
          <span className="filter-label">Tags</span>
          <div className="filter-chips">
            {ALL_TAGS.map((t) => (
              <button
                key={t}
                className={`chip ${activeTags.includes(t) ? "active" : ""}`}
                onClick={() => toggleTag(t)}
              >
                {t}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasFilters && (
        <button className="clear-filters" onClick={clearFilters}>
          <X size={14} />
          Clear all filters
        </button>
      )}

      {filtered.length === 0 ? (
        <div className="empty-state">
          <p>No writeups match your filters.</p>
          <button className="clear-filters" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      ) : (
        <div className="cards-grid">
          {filtered.map((w) => (
            <WriteupCard key={w.slug} writeup={w} onClick={onSelect} />
          ))}
        </div>
      )}
    </div>
  );
}
