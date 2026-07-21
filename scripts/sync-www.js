import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const www = join(root, "www");

const COPY_ITEMS = [
  "index.html",
  "manifest.webmanifest",
  "service-worker.js",
  "css",
  "js",
  "icons",
  "assets"
];

function copyRecursive(src, dest) {
  cpSync(src, dest, { recursive: true });
}

function copyCapacitorVendor() {
  const vendorDir = join(root, "vendor", "capacitor");
  mkdirSync(vendorDir, { recursive: true });
  const coreSrc = join(root, "node_modules", "@capacitor", "core", "dist", "index.js");
  if (!existsSync(coreSrc)) {
    throw new Error("Missing @capacitor/core. Run npm install first.");
  }
  copyRecursive(coreSrc, join(vendorDir, "core.js"));
}

function syncWww() {
  if (existsSync(www)) {
    rmSync(www, { recursive: true, force: true });
  }
  mkdirSync(www, { recursive: true });

  for (const item of COPY_ITEMS) {
    const src = join(root, item);
    if (!existsSync(src)) continue;
    copyRecursive(src, join(www, item));
  }

  copyCapacitorVendor();
  copyRecursive(join(root, "vendor"), join(www, "vendor"));

  const skipped = ["node_modules", "android", ".git", "www", "google-apps-script"];
  console.log(`Synced web assets to ${www}`);
  console.log(`Skipped: ${skipped.join(", ")}`);
}

syncWww();
