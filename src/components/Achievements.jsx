import { useState, useEffect, useCallback } from "react";
import { Trophy, X, ArrowLeft, Calendar, Award } from "lucide-react";

function parseDate(filename) {
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

export default function Achievements({ onBack }) {
  const [images, setImages] = useState([]);
  const [lightbox, setLightbox] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    const ctx = import.meta.glob("/public/assets/screenshots/achievements/*.png", {
      eager: true,
      query: "?url",
      import: "default",
    });
    const entries = Object.entries(ctx)
      .map(([path, url], i) => {
        const name = path.split("/").pop();
        return {
          id: i,
          url,
          name,
          date: parseDate(name),
          index: i + 1,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    setImages(entries);
    requestAnimationFrame(() => setLoaded(true));
  }, []);

  const handleKeyDown = useCallback(
    (e) => {
      if (e.key === "Escape") setLightbox(null);
    },
    []
  );

  useEffect(() => {
    if (lightbox) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    } else {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [lightbox, handleKeyDown]);

  return (
    <div className="achievements-page">
      <div className="achievements-hero">
        <div className="achievements-hero-bg" />
        <div className="achievements-hero-content">
          <button className="achievements-back" onClick={onBack}>
            <ArrowLeft size={18} />
            Back
          </button>
          <div className="achievements-hero-text">
            <Trophy size={40} className="achievements-hero-icon" />
            <h1>Achievements</h1>
            <p>
              <Award size={16} />
              {images.length} rooms conquered
            </p>
          </div>
        </div>
      </div>

      <div className="achievements-stats">
        <div className="stat-card">
          <span className="stat-number">{images.length}</span>
          <span className="stat-label">Rooms Completed</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {new Set(images.map((i) => i.date?.split(" ")[0]).filter(Boolean)).size}
          </span>
          <span className="stat-label">Active Months</span>
        </div>
        <div className="stat-card">
          <span className="stat-number">
            {images.filter((i) => i.date).length}
          </span>
          <span className="stat-label">Dated Completions</span>
        </div>
      </div>

      <div className="achievements-grid">
        {images.map((img, i) => (
          <div
            key={img.id}
            className={`achievement-card ${loaded ? "visible" : ""}`}
            style={{ animationDelay: `${i * 50}ms` }}
            onClick={() => setLightbox(img)}
          >
            <div className="achievement-card-img-wrap">
              <img src={img.url} alt={`Room completion ${img.index}`} loading="lazy" />
              <div className="achievement-card-overlay">
                <div className="achievement-card-info">
                  <span className="achievement-card-number">#{img.index}</span>
                  {img.date && (
                    <span className="achievement-card-date">
                      <Calendar size={12} />
                      {img.date}
                    </span>
                  )}
                </div>
              </div>
            </div>
            <div className="achievement-card-footer">
              {img.date ? (
                <span className="achievement-card-date">
                  <Calendar size={13} />
                  {img.date}
                </span>
              ) : (
                <span className="achievement-card-date">Untitled</span>
              )}
              <span className="achievement-card-number">#{img.index}</span>
            </div>
          </div>
        ))}
      </div>

      {lightbox && (
        <div className="lightbox-overlay" onClick={() => setLightbox(null)}>
          <div className="lightbox-content" onClick={(e) => e.stopPropagation()}>
            <button className="lightbox-close" onClick={() => setLightbox(null)}>
              <X size={24} />
            </button>
            <img src={lightbox.url} alt={`Room completion ${lightbox.index}`} />
            <div className="lightbox-info">
              <span>Completion #{lightbox.index}</span>
              {lightbox.date && (
                <span className="lightbox-date">{lightbox.date}</span>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
