import { useState, useEffect } from "react";
import Navbar from "./components/Navbar";
import WriteupList from "./components/WriteupList";
import WriteupDetail from "./components/WriteupDetail";
import NewWriteup from "./components/NewWriteup";
import "./App.css";

const writeupFiles = import.meta.glob("./writeups/*.md", { query: "?raw", import: "default", eager: true });

function parseFrontmatter(raw) {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const frontmatter = match[1];
  const content = match[2].trim();
  const data = {};
  const lines = frontmatter.split("\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (val.startsWith("[")) {
      data[key] = val.slice(1, -1).split(",").map((s) => s.trim().replace(/^"(.*)"$/, "$1"));
    } else {
      data[key] = val.replace(/^"(.*)"$/, "$1");
    }
  }
  return { ...data, content, slug: data.title?.toLowerCase().replace(/\s+/g, "-") || "untitled" };
}

const STORAGE_KEY = "writer-blog-custom-writeups";

function loadCustomWriteups() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveCustomWriteup(writeup) {
  const existing = loadCustomWriteups();
  existing.unshift(writeup);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  return existing;
}

export default function App() {
  const [writeups, setWriteups] = useState([]);
  const [selected, setSelected] = useState(null);
  const [showNew, setShowNew] = useState(false);

  useEffect(() => {
    const fileWriteups = Object.values(writeupFiles)
      .map((mod) => parseFrontmatter(mod.default || mod))
      .filter(Boolean);
    const customWriteups = loadCustomWriteups();
    const all = [...customWriteups, ...fileWriteups].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
    setWriteups(all);
  }, []);

  const handleNewSave = (writeup) => {
    const updated = saveCustomWriteup(writeup);
    const fileWriteups = Object.values(writeupFiles)
      .map((mod) => parseFrontmatter(mod.default || mod))
      .filter(Boolean);
    const all = [...updated, ...fileWriteups].sort(
      (a, b) => new Date(b.date) - new Date(a.date)
    );
    setWriteups(all);
  };

  if (showNew) {
    return (
      <>
        <Navbar onHome={() => { setShowNew(false); setSelected(null); }} />
        <main className="container">
          <NewWriteup
            onBack={() => setShowNew(false)}
            onSave={(writeup) => {
              handleNewSave(writeup);
              setShowNew(false);
            }}
          />
        </main>
      </>
    );
  }

  if (selected) {
    return (
      <>
        <Navbar
          onHome={() => { setSelected(null); setShowNew(false); }}
          onNew={() => setShowNew(true)}
        />
        <main className="container">
          <WriteupDetail writeup={selected} onBack={() => setSelected(null)} />
        </main>
      </>
    );
  }

  return (
    <>
      <Navbar
        onHome={() => { setSelected(null); setShowNew(false); }}
        onNew={() => setShowNew(true)}
      />
      <main className="container">
        <WriteupList writeups={writeups} onSelect={setSelected} />
      </main>
    </>
  );
}
