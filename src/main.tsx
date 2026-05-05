import ReactDOM from "react-dom/client";
import { restoreStateCurrent, StateFlags } from "@tauri-apps/plugin-window-state";
import App from "./App";

restoreStateCurrent(StateFlags.ALL).catch(() => {});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />
);
