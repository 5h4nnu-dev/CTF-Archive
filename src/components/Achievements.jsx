import { useState, useEffect, useCallback, useRef } from "react";
import { Trophy, X, ArrowLeft, Calendar, Award } from "lucide-react";

function parseDate(filename) {
  const match = filename.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const [, y, m, d] = match;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m) - 1]} ${parseInt(d)}, ${y}`;
}

const NEON_COLORS = [
  "#00f0ff",
  "#ff3c88",
  "#b44dff",
  "#00ff87",
  "#ffd700",
  "#ff6b35",
  "#ff2d55",
  "#7b61ff",
];

function getNeon(index) {
  return NEON_COLORS[index % NEON_COLORS.length];
}

function useCountUp(end, duration = 2000, started = false) {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!started) return;
    let startTime = null;
    let raf;
    const fn = (ts) => {
      if (!startTime) startTime = ts;
      const p = Math.min((ts - startTime) / duration, 1);
      setCount(Math.floor(p * end));
      if (p < 1) raf = requestAnimationFrame(fn);
    };
    raf = requestAnimationFrame(fn);
    return () => cancelAnimationFrame(raf);
  }, [end, duration, started]);
  return count;
}

function StatCard({ value, label, icon: Icon, delay, color }) {
  const [visible, setVisible] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const obs = new IntersectionObserver(([e]) => {
      if (e.isIntersecting) {
        setTimeout(() => setVisible(true), delay);
        obs.disconnect();
      }
    }, { threshold: 0.3 });
    if (ref.current) obs.observe(ref.current);
    return () => obs.disconnect();
  }, [delay]);
  const count = useCountUp(value, 2200, visible);
  return (
    <div
      className={`stat-card ${visible ? "visible" : ""}`}
      ref={ref}
      style={{ "--stat-clr": color }}
    >
      <div className="stat-card-glow" />
      <Icon className="stat-icon" size={22} />
      <span className="stat-number">{count}</span>
      <span className="stat-label">{label}</span>
    </div>
  );
}

function TiltCard({ img, loaded, onClick }) {
  const ref = useRef(null);
  const [tiltStyle, setTiltStyle] = useState({});
  const [hover, setHover] = useState(false);
  const [mag, setMag] = useState({ x: 50, y: 50, active: false });

  const base = `rotate(${img._rotate}deg) translateY(${img._yOff}px)`;

  const handleMove = useCallback((e) => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    setTiltStyle({
      transform: `${base} perspective(800px) rotateX(${-y * 14}deg) rotateY(${x * 14}deg) scale3d(1.03, 1.03, 1.03)`,
      transition: "transform 0.08s linear",
    });
    setHover(true);
  }, [base]);

  const handleLeave = useCallback(() => {
    setTiltStyle({
      transform: base,
      transition: "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
    });
    setHover(false);
    setMag((p) => ({ ...p, active: false }));
  }, [base]);

  const handleImgMove = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMag({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
      active: true,
    });
  }, []);

  const handleImgLeave = useCallback(() => {
    setMag((p) => ({ ...p, active: false }));
  }, []);

  return (
    <div
      ref={ref}
      className={`card ${loaded ? "visible" : ""} ${hover ? "hovering" : ""}`}
      style={{
        animationDelay: `${img._animDelay}ms`,
        "--c-accent": img._accent,
        "--c-shadow": img._shadow,
        "--rot": `${img._rotate}deg`,
        "--yoff": `${img._yOff}px`,
        ...tiltStyle,
      }}
      onClick={onClick}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
    >
      <div className="card-shine" />
      <div className="card-shimmer" />
      <div className="card-frame">
        <div className="card-img-wrap">
          <img
            src={img.url}
            alt={`Room completion ${img.index}`}
            loading="lazy"
            onMouseMove={handleImgMove}
            onMouseLeave={handleImgLeave}
            style={{
              transformOrigin: `${mag.x}% ${mag.y}%`,
              transform: mag.active ? "scale(1.9)" : "scale(1)",
              transition: mag.active ? "transform 0.05s linear" : "transform 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)",
            }}
          />
          <div className="card-overlay">
            <div className="card-info">
              <span className="card-num">#{img.index}</span>
              {img.date && (
                <span className="card-dt">
                  <Calendar size={11} />
                  {img.date}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="card-foot">
          {img.date ? (
            <span className="card-dt">
              <Calendar size={12} />
              {img.date}
            </span>
          ) : (
            <span className="card-dt untitled">Untitled</span>
          )}
          <span className="card-num">#{img.index}</span>
        </div>
      </div>
    </div>
  );
}

function ParticleField() {
  const particles = useRef(null);
  return (
    <div className="particle-field" ref={particles}>
      {Array.from({ length: 35 }, (_, i) => (
        <div
          key={i}
          className="particle"
          style={{
            "--px": `${Math.random() * 100}%`,
            "--py": `${Math.random() * 100}%`,
            "--ps": `${Math.random() * 5 + 2}px`,
            "--pd": `${Math.random() * 12 + 10}s`,
            "--po": `${Math.random() * 6}s`,
            "--pc": NEON_COLORS[Math.floor(Math.random() * NEON_COLORS.length)],
          }}
        />
      ))}
    </div>
  );
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
        const color = getNeon(i);
        return {
          id: i, url, name, date: parseDate(name), index: i + 1,
          _accent: color,
          _shadow: color + "33",
          _animDelay: i * 70,
          _rotate: (Math.random() - 0.5) * 5,
          _yOff: (Math.random() - 0.5) * 24,
          _floatDelay: `${Math.random() * 4}s`,
          _shimmerDelay: `${Math.random() * 6 + 2}s`,
        };
      })
      .sort((a, b) => new Date(b.date) - new Date(a.date));
    setImages(entries);
    requestAnimationFrame(() => setLoaded(true));
  }, []);

  const handleKey = useCallback((e) => {
    if (e.key === "Escape") setLightbox(null);
  }, []);

  useEffect(() => {
    if (lightbox) {
      document.addEventListener("keydown", handleKey);
      document.body.style.overflow = "hidden";
    } else {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    }
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.body.style.overflow = "";
    };
  }, [lightbox, handleKey]);

  const activeMonths = new Set(images.map((i) => i.date?.split(" ")[0]).filter(Boolean)).size;
  const dated = images.filter((i) => i.date).length;

  return (
    <div className="achievements-page">
      <ParticleField />

      <section className="achievements-hero">
        <div className="hero-glow" />
        <div className="hero-grid" />
        <div className="hero-content">
          <button className="back-btn" onClick={onBack}>
            <ArrowLeft size={15} />
            Back
          </button>
          <div className="hero-text">
            <div className="trophy-wrap">
              <div className="trophy-ring" />
              <div className="trophy-ring-2" />
              <Trophy size={52} className="trophy-icon" />
            </div>
            <h1 className="hero-title">Achievements</h1>
            <p className="hero-sub">
              <Award size={14} />
              <span>{images.length} rooms conquered</span>
            </p>
          </div>
        </div>
        <div className="hero-fade" />
      </section>

      <section className="stats-section">
        <StatCard value={images.length} label="Rooms Conquered" icon={Trophy} delay={150} color={NEON_COLORS[0]} />
        <StatCard value={activeMonths} label="Active Months" icon={Calendar} delay={350} color={NEON_COLORS[2]} />
        <StatCard value={dated} label="Completions Dated" icon={Award} delay={550} color={NEON_COLORS[4]} />
      </section>

      <section className="cards-section">
        <div className="cards-grid">
          {images.map((img) => (
            <TiltCard key={img.id} img={img} loaded={loaded} onClick={() => setLightbox(img)} />
          ))}
        </div>
      </section>

      {lightbox && (
        <div className="lb-overlay" onClick={() => setLightbox(null)}>
          <div className="lb-content" onClick={(e) => e.stopPropagation()}>
            <button className="lb-close" onClick={() => setLightbox(null)}>
              <X size={24} />
            </button>
            <img src={lightbox.url} alt={`Room completion ${lightbox.index}`} />
            <div className="lb-info">
              <span>Completion #{lightbox.index}</span>
              {lightbox.date && <span className="lb-date">{lightbox.date}</span>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
