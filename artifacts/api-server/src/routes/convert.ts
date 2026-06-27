import express, { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const router = Router();

async function runConvert(inputBytes: Buffer, res: any) {
  const id = randomUUID();
  const inPath = join(tmpdir(), `${id}.in`);
  const oggPath = join(tmpdir(), `${id}.ogg`);
  try {
    await writeFile(inPath, inputBytes);
    await execAsync(
      `ffmpeg -y -i ${inPath} -c:a libopus -b:a 64k -vbr on ${oggPath}`
    );
    const oggBytes = await readFile(oggPath);
    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Content-Length", String(oggBytes.length));
    res.send(oggBytes);
  } finally {
    for (const p of [inPath, oggPath]) {
      unlink(p).catch(() => {});
    }
  }
}

// POST: body is raw audio bytes (MP3, WAV, etc.) — used by Cloudflare Worker
router.post("/convert", express.raw({ type: "*/*", limit: "50mb" }), async (req, res) => {
  try {
    if (!req.body || !Buffer.isBuffer(req.body) || req.body.length === 0) {
      res.status(400).json({ error: "Empty body" });
      return;
    }
    await runConvert(req.body, res);
  } catch (err: any) {
    res.status(500).json({ error: String(err.message) });
  }
});

// GET: fetch audio from a URL then convert (kept for other callers)
router.get("/convert", async (req, res) => {
  const audioUrl = req.query.url as string;
  if (!audioUrl) {
    res.status(400).json({ error: "Missing url param" });
    return;
  }
  try {
    const audioResp = await fetch(audioUrl);
    if (!audioResp.ok) {
      res.status(502).json({ error: `Upstream fetch failed: ${audioResp.status}` });
      return;
    }
    await runConvert(Buffer.from(await audioResp.arrayBuffer()), res);
  } catch (err: any) {
    res.status(500).json({ error: String(err.message) });
  }
});

export default router;
