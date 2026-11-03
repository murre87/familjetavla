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
