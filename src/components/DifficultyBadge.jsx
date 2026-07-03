const difficultyColors = {
  Easy: { bg: "#162e22", text: "#4ade80" },
  Medium: { bg: "#2e2316", text: "#fb923c" },
  Hard: { bg: "#2e1616", text: "#f87171" },
  Insane: { bg: "#22162e", text: "#c084fc" },
};

export default function DifficultyBadge({ difficulty }) {
  const colors = difficultyColors[difficulty] || difficultyColors.Easy;
  return (
    <span
      className="difficulty-badge"
      style={{ backgroundColor: colors.bg, color: colors.text }}
    >
      {difficulty}
    </span>
  );
}
