import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./install";
import { applyScale, readScale } from "./uiscale";
import { App } from "./App";
import { IpadFrame, wantsIpadFrame } from "./IpadFrame";
import "./styles.css";
import "./flat.css";

applyScale(readScale());

createRoot(document.getElementById("root")!).render(<StrictMode>{wantsIpadFrame() ? <IpadFrame /> : <App />}</StrictMode>);


// A tablet board is not pinch-zoomed (it has its own "Storlek"): on an iPad a zoomed page is cut off at the edge and can be dragged sideways.
document.addEventListener("gesturestart", (e) => {
  if (Math.min(window.innerWidth, window.innerHeight) >= 600) e.preventDefault();
});
