import { Shield, Plus } from "lucide-react";

export default function Navbar({ onHome, onNew }) {
  return (
    <nav className="navbar">
      <div className="navbar-inner">
        <button className="navbar-brand" onClick={onHome}>
          <Shield size={22} />
          <span>THM Writeups</span>
        </button>
        <div className="navbar-actions">
          <button className="navbar-new" onClick={onNew} title="New Writeup">
            <Plus size={18} />
            <span>New</span>
          </button>
        </div>
      </div>
    </nav>
  );
}
