import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { defineConfig, type PluginOption } from "vite";

function copyExtensionFiles(): PluginOption {
  return {
    name: "copy-extension-files",
    writeBundle() {
      const manifestOutputPath = resolve("dist/manifest.json");
      mkdirSync(dirname(manifestOutputPath), { recursive: true });
      copyFileSync(resolve("manifest.json"), manifestOutputPath);
    },
  };
}

export default defineConfig({
  base: "./",
  publicDir: false,
  plugins: [copyExtensionFiles()],
  build: {
    emptyOutDir: true,
    rollupOptions: {
      input: {
        content: resolve("src/content.ts"),
        "popup/popup": resolve("src/popup/popup.html"),
      },
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "assets/[name][extname]",
      },
    },
  },
});
