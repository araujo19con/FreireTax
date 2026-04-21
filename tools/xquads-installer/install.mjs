#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_DIR = path.join(SCRIPT_DIR, "xquads-squads");
const DEST_DIR = path.join(os.homedir(), ".claude", "agents", "xquads");

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has("--dry-run");
const FLAT = args.has("--flat");

function shortSquadName(dirName) {
  return dirName.replace(/-squad$/, "");
}

function sanitizeDescription(s) {
  if (!s) return "";
  return String(s).replace(/\s+/g, " ").replace(/"/g, '\\"').trim();
}

function extractYamlBlock(content) {
  const m = content.match(/```ya?ml\s*\n([\s\S]*?)\n```/);
  return m ? m[1] : null;
}

function extractAgentSection(yamlBlock) {
  const lines = yamlBlock.split("\n");
  const startIdx = lines.findIndex((l) => /^agent\s*:\s*$/.test(l));
  if (startIdx < 0) return null;
  const collected = [lines[startIdx]];
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^[A-Za-z_][\w-]*\s*:/.test(line)) break;
    collected.push(line);
  }
  return collected.join("\n");
}

function parseAgentFlexibly(yamlBlock) {
  try {
    const full = yaml.load(yamlBlock);
    if (full?.agent) return full.agent;
  } catch {
    // fall through to narrow parse
  }
  const section = extractAgentSection(yamlBlock);
  if (!section) return null;
  try {
    const narrow = yaml.load(section);
    return narrow?.agent || null;
  } catch {
    return null;
  }
}

async function collectAgentDirs() {
  const entries = await fs.readdir(SOURCE_DIR, { withFileTypes: true });
  const dirs = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (e.name.startsWith(".")) continue;
    const agentsPath = path.join(SOURCE_DIR, e.name, "agents");
    try {
      const stat = await fs.stat(agentsPath);
      if (stat.isDirectory()) dirs.push({ squad: e.name, agentsPath });
    } catch {
      // no agents/ subdir — skip
    }
  }
  return dirs;
}

async function listAgentFiles(agentsPath) {
  const entries = await fs.readdir(agentsPath, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => path.join(agentsPath, e.name));
}

function buildFrontmatter({ name, description }) {
  const desc = sanitizeDescription(description);
  return `---\nname: ${name}\ndescription: "${desc}"\n---\n`;
}

function deriveOutputName({ squadShort, agentId, fileBase, flat }) {
  const id = agentId || fileBase;
  if (flat) return `xquads-${squadShort}-${id}.md`;
  return `${squadShort}-${id}.md`;
}

async function main() {
  const squads = await collectAgentDirs();
  if (squads.length === 0) {
    console.error(`No squad directories found at ${SOURCE_DIR}`);
    process.exit(1);
  }

  const outDir = FLAT ? path.join(os.homedir(), ".claude", "agents") : DEST_DIR;
  if (!DRY_RUN) await fs.mkdir(outDir, { recursive: true });

  const stats = { installed: 0, skipped: 0, squads: {} };
  const skippedReasons = [];

  for (const { squad, agentsPath } of squads) {
    const squadShort = shortSquadName(squad);
    stats.squads[squad] = 0;
    const files = await listAgentFiles(agentsPath);
    for (const file of files) {
      const fileBase = path.basename(file, ".md");
      const content = await fs.readFile(file, "utf8");
      const yamlBlock = extractYamlBlock(content);
      if (!yamlBlock) {
        stats.skipped++;
        skippedReasons.push(`${squad}/${fileBase}: no \`\`\`yaml block found`);
        continue;
      }
      const agent = parseAgentFlexibly(yamlBlock);
      if (!agent || typeof agent !== "object") {
        stats.skipped++;
        skippedReasons.push(`${squad}/${fileBase}: could not parse agent: section`);
        continue;
      }
      const agentId = agent.id || fileBase;
      const description = agent.whenToUse || agent.title || `Agent ${agentId} from ${squad}`;
      const frontmatter = buildFrontmatter({ name: agentId, description });
      const body = content;
      const outName = deriveOutputName({ squadShort, agentId, fileBase, flat: FLAT });
      const outPath = path.join(outDir, outName);
      const finalContent = `${frontmatter}\n${body}`;
      if (DRY_RUN) {
        console.log(`would write: ${outPath} (${finalContent.length} bytes, desc="${sanitizeDescription(description).slice(0, 60)}...")`);
      } else {
        await fs.writeFile(outPath, finalContent, "utf8");
      }
      stats.installed++;
      stats.squads[squad]++;
    }
  }

  console.log("");
  console.log(DRY_RUN ? "DRY RUN SUMMARY" : "INSTALL SUMMARY");
  console.log("─".repeat(50));
  for (const [squad, count] of Object.entries(stats.squads)) {
    console.log(`  ${squad.padEnd(24)} ${count} agents`);
  }
  console.log("─".repeat(50));
  console.log(`  Total installed: ${stats.installed}`);
  console.log(`  Total skipped:   ${stats.skipped}`);
  if (skippedReasons.length) {
    console.log("");
    console.log("Skipped reasons:");
    skippedReasons.forEach((r) => console.log(`  - ${r}`));
  }
  console.log("");
  console.log(`Destination: ${outDir}`);
  if (DRY_RUN) console.log("(dry run — no files written)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
