# THM Writeups

A React-based blog for publishing and browsing TryHackMe CTF walkthroughs. Built with Vite.

## Features

- **Writeup Browsing** — Responsive card grid listing all writeups with title, description, difficulty badge, tags, and date.
- **Full-Text Search** — Search across writeup titles, descriptions, and tags with a live search bar.
- **Difficulty & Tag Filtering** — Filter writeups by difficulty (Easy, Medium, Hard, Insane) and by tag. Multiple tags can be combined.
- **Writeup Detail View** — Full-screen markdown-rendered view of each writeup with syntax-highlighted code blocks and back navigation.
- **Create New Writeups** — In-app form to author new writeups with frontmatter metadata (title, description, difficulty, date, tags) and markdown content.
- **Local Persistence** — Custom writeups are saved to `localStorage` and persist across sessions.
- **Download as Markdown** — Export any writeup as a `.md` file with proper YAML frontmatter.
- **Color-Coded Difficulty Badges** — Each difficulty level has a distinct color (Easy = green, Medium = orange, Hard = red, Insane = purple).
- **Dark Theme UI** — Modern dark-themed design with glassmorphism navbar, smooth transitions, and responsive layout.
- **Markdown from File** — Writeups are loaded from `src/writeups/*.md` files using Vite's `import.meta.glob` with frontmatter parsing.

## Tech Stack

- **React 19** — UI framework
- **Vite 8** — Build tool with HMR and Oxlint
- **react-markdown** — Markdown rendering
- **Lucide React** — Icon library
- **front-matter** — Frontmatter parsing

## Getting Started

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
├── assets/          # Static images
├── components/      # React components (Navbar, WriteupList, WriteupCard, etc.)
├── writeups/        # Markdown writeup files with YAML frontmatter
├── App.jsx          # Main app with routing logic
├── App.css          # All styles
├── index.css        # Global reset
└── main.jsx         # Entry point
```
