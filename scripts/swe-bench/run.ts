#!/usr/bin/env tsx
/**
 * SWE-bench Runner for Multica
 *
 * Runs the Multica agent against SWE-bench task instances and collects patches.
 *
 * Usage:
 *   tsx scripts/swe-bench/run.ts [options]
 *
 * Options:
 *   --dataset PATH      Path to JSONL dataset (default: scripts/swe-bench/lite.jsonl)
 *   --provider NAME     LLM provider (default: kimi-coding)
 *   --model NAME        Model name
 *   --limit N           Max tasks to run (default: all)
 *   --offset N          Skip first N tasks (default: 0)
 *   --output PATH       Output predictions JSONL (default: scripts/swe-bench/predictions.jsonl)
 *   --workdir PATH      Working directory for repos (default: /tmp/swe-bench)
 *   --timeout MS        Timeout per task in ms (default: 300000 = 5min)
 *   --instance ID       Run a single instance by ID
 *   --debug             Enable debug logging
 */

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { execSync, spawn } from "node:child_process";
import { Agent } from "@multica/core";
import type { AgentOptions } from "@multica/core";

// ============================================================
// Types
// ============================================================

interface SWEBenchTask {
  instance_id: string;
  repo: string;
  base_commit: string;
  problem_statement: string;
  hints_text?: string;
  patch?: string;
  test_patch?: string;
  version?: string;
  environment_setup_commit?: string;
}

interface Prediction {
  instance_id: string;
  model_patch: string;
  model_name_or_path: string;
}

interface RunResult {
  instance_id: string;
  success: boolean;
  patch: string;
  error?: string;
  duration_ms: number;
  session_id: string;
}

// ============================================================
// CLI argument parsing
// ============================================================

interface RunOptions {
  dataset: string;
  provider: string;
  model?: string;
  limit: number;
  offset: number;
  output: string;
  workdir: string;
  timeout: number;
  instance?: string;
  debug: boolean;
}

function parseArgs(): RunOptions {
  const args = process.argv.slice(2);
  const opts: RunOptions = {
    dataset: "scripts/swe-bench/lite.jsonl",
    provider: "kimi-coding",
    limit: 0,
    offset: 0,
    output: "scripts/swe-bench/predictions.jsonl",
    workdir: "/tmp/swe-bench",
    timeout: 300_000, // 5 minutes
    debug: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--dataset") opts.dataset = args[++i]!;
    else if (arg === "--provider") opts.provider = args[++i]!;
    else if (arg === "--model") opts.model = args[++i]!;
    else if (arg === "--limit") opts.limit = parseInt(args[++i]!, 10);
    else if (arg === "--offset") opts.offset = parseInt(args[++i]!, 10);
    else if (arg === "--output") opts.output = args[++i]!;
    else if (arg === "--workdir") opts.workdir = args[++i]!;
    else if (arg === "--timeout") opts.timeout = parseInt(args[++i]!, 10);
    else if (arg === "--instance") opts.instance = args[++i]!;
    else if (arg === "--debug") opts.debug = true;
    else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  return opts;
}

// ============================================================
// Dataset loading
// ============================================================

function loadDataset(path: string): SWEBenchTask[] {
  if (!existsSync(path)) {
    console.error(`Dataset not found: ${path}`);
    console.error("Run: python scripts/swe-bench/download-dataset.py");
    process.exit(1);
  }
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  return lines.map((line) => JSON.parse(line) as SWEBenchTask);
}

// ============================================================
// Repository setup
// ============================================================

function setupRepo(task: SWEBenchTask, workdir: string): string {
  const repoDir = join(workdir, task.instance_id.replace(/\//g, "__"));

  if (existsSync(repoDir)) {
    // Reset existing repo to base commit
    log(`  Resetting existing repo to ${task.base_commit.slice(0, 8)}...`);
    execSync(`git checkout -f ${task.base_commit} && git clean -fdx`, {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 60_000,
    });
  } else {
    // Clone from GitHub
    const repoUrl = `https://github.com/${task.repo}.git`;
    log(`  Cloning ${task.repo}...`);
    mkdirSync(workdir, { recursive: true });
    execSync(`git clone --quiet ${repoUrl} "${repoDir}"`, {
      stdio: "pipe",
      timeout: 120_000,
    });
    execSync(`git checkout -f ${task.base_commit}`, {
      cwd: repoDir,
      stdio: "pipe",
      timeout: 30_000,
    });
  }

  return repoDir;
}

// ============================================================
// System prompt
// ============================================================

function buildSystemPrompt(task: SWEBenchTask): string {
  return `You are an expert software engineer tasked with fixing a bug in an open-source repository.

## Instructions

1. Read the issue description carefully and understand the problem.
2. Explore the repository to find the relevant source code.
3. Identify the root cause of the issue.
4. Make the minimal set of changes to fix the issue. Do NOT add tests.
5. After making changes, verify your fix makes sense.

## Important Rules

- Make ONLY the changes necessary to fix the described issue.
- Do NOT modify or add any test files.
- Do NOT add comments explaining the fix unless the code is non-obvious.
- Do NOT refactor unrelated code.
- Keep changes minimal and focused.

## Repository

This is the \`${task.repo}\` repository checked out at commit \`${task.base_commit.slice(0, 12)}\`.`;
}

function buildPrompt(task: SWEBenchTask): string {
  let prompt = `## Issue\n\n${task.problem_statement}`;
  if (task.hints_text) {
    prompt += `\n\n## Hints\n\n${task.hints_text}`;
  }
  prompt += `\n\nPlease fix this issue. Remember: make minimal changes, do not modify tests.`;
  return prompt;
}

// ============================================================
// Run a single task
// ============================================================

async function runTask(
  task: SWEBenchTask,
  opts: RunOptions,
): Promise<RunResult> {
  const start = Date.now();

  // Setup repo
  const repoDir = setupRepo(task, opts.workdir);

  // Create agent
  const agentOptions: AgentOptions = {
    provider: opts.provider,
    model: opts.model,
    cwd: repoDir,
    enableRunLog: true,
    debug: opts.debug,
    systemPrompt: buildSystemPrompt(task),
    enableSkills: false,
    tools: {
      // Only allow coding tools — no web, no cron, no sessions
      deny: ["web_fetch", "web_search", "cron", "data", "delegate", "memory_search", "send_file"],
    },
  };

  const agent = new Agent(agentOptions);

  log(`  Session: ${agent.sessionId}`);

  try {
    // Run agent with timeout
    const result = await Promise.race([
      agent.run(buildPrompt(task)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), opts.timeout),
      ),
    ]);

    // Collect the git diff (the patch)
    let patch = "";
    try {
      patch = execSync("git diff", {
        cwd: repoDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: 10_000,
      });
    } catch {
      // Also check for staged changes
      try {
        patch = execSync("git diff HEAD", {
          cwd: repoDir,
          encoding: "utf-8",
          maxBuffer: 10 * 1024 * 1024,
          timeout: 10_000,
        });
      } catch {
        patch = "";
      }
    }

    return {
      instance_id: task.instance_id,
      success: patch.length > 0,
      patch,
      error: result.error,
      duration_ms: Date.now() - start,
      session_id: agent.sessionId,
    };
  } catch (err) {
    // Collect any partial patch
    let patch = "";
    try {
      patch = execSync("git diff", {
        cwd: repoDir,
        encoding: "utf-8",
        maxBuffer: 10 * 1024 * 1024,
        timeout: 10_000,
      });
    } catch {
      // ignore
    }

    return {
      instance_id: task.instance_id,
      success: false,
      patch,
      error: err instanceof Error ? err.message : String(err),
      duration_ms: Date.now() - start,
      session_id: agent.sessionId,
    };
  }
}

// ============================================================
// Logging
// ============================================================

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.error(`[${ts}] ${msg}`);
}

// ============================================================
// Main
// ============================================================

async function main() {
  const opts = parseArgs();

  log("SWE-bench Runner for Multica");
  log(`Provider: ${opts.provider}${opts.model ? ` (${opts.model})` : ""}`);
  log(`Dataset: ${opts.dataset}`);
  log(`Work dir: ${opts.workdir}`);
  log(`Timeout: ${opts.timeout / 1000}s per task`);

  // Set SMC_DATA_DIR for isolation
  if (!process.env.SMC_DATA_DIR) {
    process.env.SMC_DATA_DIR = join(process.env.HOME || "~", ".swe-bench-eval");
    log(`SMC_DATA_DIR: ${process.env.SMC_DATA_DIR}`);
  }

  // Load dataset
  let tasks = loadDataset(resolve(opts.dataset));
  log(`Loaded ${tasks.length} tasks`);

  // Filter by instance ID if specified
  if (opts.instance) {
    tasks = tasks.filter((t) => t.instance_id === opts.instance);
    if (tasks.length === 0) {
      console.error(`Instance not found: ${opts.instance}`);
      process.exit(1);
    }
  }

  // Apply offset and limit
  if (opts.offset > 0) {
    tasks = tasks.slice(opts.offset);
  }
  if (opts.limit > 0) {
    tasks = tasks.slice(0, opts.limit);
  }

  log(`Running ${tasks.length} tasks`);

  // Prepare output
  const outputPath = resolve(opts.output);
  const resultsPath = outputPath.replace(".jsonl", ".results.jsonl");

  // Run tasks sequentially
  const modelName = `multica-${opts.provider}${opts.model ? `-${opts.model}` : ""}`;
  let completed = 0;
  let succeeded = 0;

  for (const task of tasks) {
    completed++;
    log(`\n[${completed}/${tasks.length}] ${task.instance_id}`);

    const result = await runTask(task, opts);

    if (result.success) succeeded++;

    // Write prediction in SWE-bench format
    const prediction: Prediction = {
      instance_id: result.instance_id,
      model_patch: result.patch,
      model_name_or_path: modelName,
    };
    appendFileSync(outputPath, JSON.stringify(prediction) + "\n");

    // Write detailed result
    appendFileSync(resultsPath, JSON.stringify(result) + "\n");

    const status = result.success ? "PATCHED" : "NO_PATCH";
    const errorInfo = result.error ? ` (${result.error})` : "";
    log(
      `  ${status} | ${(result.duration_ms / 1000).toFixed(1)}s | patch=${result.patch.length} bytes${errorInfo}`,
    );
  }

  log(`\n========================================`);
  log(`Results: ${succeeded}/${completed} tasks produced patches`);
  log(`Predictions: ${outputPath}`);
  log(`Details: ${resultsPath}`);
  log(`\nTo evaluate with SWE-bench harness:`);
  log(
    `  python -m swebench.harness.run_evaluation --dataset_name princeton-nlp/SWE-bench_Lite --predictions_path ${outputPath} --max_workers 4 --run_id multica`,
  );
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
