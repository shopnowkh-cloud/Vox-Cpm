/**
 * Deploy Vox Studio to Cloudflare Pages.
 * Run: node scripts/deploy-cf.mjs
 *
 * Requires CF_API_TOKEN and CF_ACCOUNT_ID in environment (Replit secrets).
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(__dirname, "..");

const CF_API_TOKEN = process.env.CF_API_TOKEN;
const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID;

if (!CF_API_TOKEN || !CF_ACCOUNT_ID) {
  console.error("Error: CF_API_TOKEN and CF_ACCOUNT_ID must be set as secrets.");
  process.exit(1);
}

const cfPagesDir = path.join(workspaceRoot, "cf-pages");
const distDir = path.join(cfPagesDir, "dist");
const buildOutput = path.join(workspaceRoot, "artifacts/tts-ui/dist/public");

function run(cmd, opts = {}) {
  console.log(`\n> ${cmd}\n`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

// 1. Build the React frontend
console.log("=== Building React frontend ===");
run("pnpm --filter @workspace/tts-ui run build", {
  cwd: workspaceRoot,
  env: {
    ...process.env,
    PORT: "18193",
    BASE_PATH: "/",
    NODE_ENV: "production",
  },
});

// 2. Copy build output into cf-pages/dist/
console.log("\n=== Copying build to cf-pages/dist/ ===");
if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true });
}
fs.cpSync(buildOutput, distDir, { recursive: true });
console.log(`Copied ${buildOutput} → ${distDir}`);

// 3. Ensure the CF Pages project exists
console.log("\n=== Ensuring Cloudflare Pages project exists ===");
const checkRes = await fetch(
  `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects/vox-studio`,
  { headers: { Authorization: `Bearer ${CF_API_TOKEN}` } }
);
const checkData = await checkRes.json();

if (!checkData.success) {
  console.log("Project not found — creating it...");
  const createRes = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT_ID}/pages/projects`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CF_API_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: "vox-studio", production_branch: "main" }),
    }
  );
  const createData = await createRes.json();
  if (!createData.success) {
    console.error("Failed to create project:", JSON.stringify(createData.errors));
    process.exit(1);
  }
  console.log("Project created:", createData.result?.subdomain);
} else {
  console.log("Project exists:", checkData.result?.subdomain);
}

// 4. Deploy to Cloudflare Pages
console.log("\n=== Deploying to Cloudflare Pages ===");
run(
  "npx --yes wrangler pages deploy dist --project-name=vox-studio --branch=main --commit-dirty=true --commit-hash=deploy-1 --commit-message=deploy",
  {
    cwd: cfPagesDir,
    env: {
      ...process.env,
      CLOUDFLARE_API_TOKEN: CF_API_TOKEN,
      CLOUDFLARE_ACCOUNT_ID: CF_ACCOUNT_ID,
    },
  }
);

console.log("\n=== Deployment complete ===");
console.log("Your app is live at: https://vox-studio-eet.pages.dev");
