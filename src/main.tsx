import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

// Restore theme from localStorage on app load
const savedTheme = localStorage.getItem("gsi-theme");
if (savedTheme === "dark") {
  document.documentElement.classList.add("dark");
} else if (!savedTheme) {
  // Check if saved in DB on first load (will be synced by GeneralSettings)
}

createRoot(document.getElementById("root")!).render(<App />);
