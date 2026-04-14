import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AudioPoC } from "./AudioPoC";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AudioPoC />
  </StrictMode>,
);
