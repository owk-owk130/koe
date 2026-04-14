import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ["@koe/shared"] })],
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@koe/shared"] })],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
  },
});
