import { Router } from "express";
import { exec } from "child_process";
import { promisify } from "util";
import { writeFile, readFile, unlink } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execAsync = promisify(exec);
const router = Router();

router.get("/convert", async (req, res) => {
  const wavUrl = req.query.url as string;
  if (!wavUrl) {
    res.status(400).json({ error: "Missing url param" });
    return;
  }

  const id = randomUUID();
  const wavPath = join(tmpdir(), `${id}.wav`);
  const oggPath = join(tmpdir(), `${id}.ogg`);

  try {
    const audioResp = await fetch(wavUrl);
    if (!audioResp.ok) {
      res.status(502).json({ error: `Upstream fetch failed: ${audioResp.status}` });
      return;
    }
    const wavBytes = Buffer.from(await audioResp.arrayBuffer());
    await writeFile(wavPath, wavBytes);

    await execAsync(
      `ffmpeg -y -i ${wavPath} -c:a libopus -b:a 64k -vbr on ${oggPath}`
    );

    const oggBytes = await readFile(oggPath);
    res.setHeader("Content-Type", "audio/ogg");
    res.setHeader("Content-Length", String(oggBytes.length));
    res.send(oggBytes);
  } catch (err: any) {
    res.status(500).json({ error: String(err.message) });
  } finally {
    for (const p of [wavPath, oggPath]) {
      unlink(p).catch(() => {});
    }
  }
});

export default router;
