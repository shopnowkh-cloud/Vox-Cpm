import { Router, type IRouter } from "express";

const router: IRouter = Router();

router.get("/", (_req, res): void => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Vox Studio — VoxCPM2 TTS</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f0f13; color: #e8e8ef; min-height: 100vh; }
    .container { max-width: 760px; margin: 0 auto; padding: 2rem 1.5rem 4rem; }
    header { text-align: center; padding: 3rem 0 2.5rem; }
    header h1 { font-size: 2.4rem; font-weight: 700; letter-spacing: -0.02em; background: linear-gradient(135deg, #a78bfa, #60a5fa); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }
    header p { margin-top: 0.6rem; color: #888; font-size: 1rem; }
    .card { background: #18181f; border: 1px solid #2a2a38; border-radius: 12px; padding: 1.5rem; margin-bottom: 1.25rem; }
    .card h2 { font-size: 0.85rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; color: #a78bfa; margin-bottom: 1rem; }
    label { display: block; font-size: 0.9rem; color: #aaa; margin-bottom: 0.35rem; }
    textarea, input[type="text"], select {
      width: 100%; background: #0f0f13; border: 1px solid #2a2a38; border-radius: 8px;
      color: #e8e8ef; font-size: 0.95rem; padding: 0.65rem 0.85rem; outline: none;
      font-family: inherit; transition: border-color 0.15s;
    }
    textarea:focus, input:focus, select:focus { border-color: #a78bfa; }
    textarea { resize: vertical; min-height: 100px; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .field { margin-bottom: 1rem; }
    .field:last-child { margin-bottom: 0; }
    .slider-row { display: flex; align-items: center; gap: 0.75rem; }
    input[type="range"] { flex: 1; accent-color: #a78bfa; }
    .slider-val { font-size: 0.85rem; color: #888; min-width: 2.5rem; text-align: right; }
    .checkbox-row { display: flex; align-items: center; gap: 0.6rem; font-size: 0.9rem; color: #aaa; }
    input[type="checkbox"] { accent-color: #a78bfa; width: 16px; height: 16px; }
    .file-upload { border: 1px dashed #2a2a38; border-radius: 8px; padding: 1rem; text-align: center; cursor: pointer; color: #666; font-size: 0.85rem; transition: border-color 0.15s; }
    .file-upload:hover { border-color: #a78bfa; color: #a78bfa; }
    #refFileInput { display: none; }
    #refFileName { margin-top: 0.4rem; font-size: 0.8rem; color: #888; }
    button#synthesize {
      width: 100%; padding: 0.85rem; border-radius: 9px; border: none; cursor: pointer;
      background: linear-gradient(135deg, #7c3aed, #2563eb); color: #fff;
      font-size: 1rem; font-weight: 600; letter-spacing: 0.01em;
      transition: opacity 0.15s, transform 0.1s;
    }
    button#synthesize:hover { opacity: 0.9; }
    button#synthesize:active { transform: scale(0.98); }
    button#synthesize:disabled { opacity: 0.45; cursor: not-allowed; }
    .status { text-align: center; font-size: 0.9rem; color: #888; margin-top: 1rem; min-height: 1.4rem; }
    .status.error { color: #f87171; }
    .audio-wrap { margin-top: 1.25rem; display: none; }
    .audio-wrap audio { width: 100%; border-radius: 8px; }
    .audio-actions { display: flex; gap: 0.75rem; margin-top: 0.75rem; }
    .audio-actions a { flex: 1; text-align: center; padding: 0.55rem; border-radius: 8px; font-size: 0.85rem; font-weight: 500; text-decoration: none; border: 1px solid #2a2a38; color: #aaa; transition: border-color 0.15s, color 0.15s; }
    .audio-actions a:hover { border-color: #a78bfa; color: #a78bfa; }
    .badge { display: inline-block; font-size: 0.7rem; font-weight: 600; padding: 0.15rem 0.5rem; border-radius: 999px; background: #1e1b38; color: #a78bfa; border: 1px solid #3b3270; margin-left: 0.4rem; vertical-align: middle; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>Vox Studio</h1>
      <p>Powered by VoxCPM2 <span class="badge">HuggingFace</span></p>
    </header>

    <div class="card">
      <h2>Mode</h2>
      <div class="field">
        <label for="mode">Synthesis Mode</label>
        <select id="mode">
          <option value="voice_design">Voice Design — describe a voice from scratch</option>
          <option value="controllable_cloning">Controllable Cloning — upload reference + instructions</option>
          <option value="ultimate_cloning">Ultimate Cloning — reference + transcript for max fidelity</option>
        </select>
      </div>
    </div>

    <div class="card">
      <h2>Text</h2>
      <div class="field">
        <label for="text">Text to synthesize <span style="color:#666;font-size:0.8rem">(max 2000 chars)</span></label>
        <textarea id="text" rows="4" maxlength="2000" placeholder="Enter text here…"></textarea>
      </div>
      <div class="field">
        <label for="control">Voice Instruction</label>
        <textarea id="control" rows="2" placeholder="e.g. A warm, calm female voice with a slight Khmer accent, speaking slowly and clearly."></textarea>
      </div>
    </div>

    <div class="card" id="refCard">
      <h2>Reference Audio</h2>
      <div class="field">
        <div class="file-upload" onclick="document.getElementById('refFileInput').click()">
          Click to upload a reference audio file (WAV, MP3, OGG)
        </div>
        <input type="file" id="refFileInput" accept="audio/*" />
        <div id="refFileName"></div>
      </div>
      <div class="field" id="promptTextField" style="display:none">
        <div class="checkbox-row" style="margin-bottom:0.6rem">
          <input type="checkbox" id="usePromptText" />
          <label for="usePromptText" style="margin-bottom:0">Use reference transcript</label>
        </div>
        <textarea id="promptText" rows="2" placeholder="Transcript of the reference audio…" style="display:none"></textarea>
      </div>
    </div>

    <div class="card">
      <h2>Advanced Settings</h2>
      <div class="row">
        <div class="field">
          <label>CFG Scale</label>
          <div class="slider-row">
            <input type="range" id="cfg" min="1" max="5" step="0.1" value="2" />
            <span class="slider-val" id="cfgVal">2.0</span>
          </div>
        </div>
        <div class="field">
          <label>Options</label>
          <div class="checkbox-row" style="margin-bottom:0.5rem">
            <input type="checkbox" id="normalize" />
            <label for="normalize" style="margin-bottom:0">Normalize audio</label>
          </div>
          <div class="checkbox-row">
            <input type="checkbox" id="denoise" />
            <label for="denoise" style="margin-bottom:0">Denoise output</label>
          </div>
        </div>
      </div>
    </div>

    <button id="synthesize">Generate Speech</button>
    <div class="status" id="status"></div>

    <div class="audio-wrap" id="audioWrap">
      <audio id="audioPlayer" controls></audio>
      <div class="audio-actions">
        <a id="downloadWav" href="#" download="output.wav">⬇ Download WAV</a>
        <a id="downloadOgg" href="#" download="output.ogg">⬇ Download OGG</a>
      </div>
    </div>
  </div>

  <script>
    const modeEl = document.getElementById('mode');
    const refCard = document.getElementById('refCard');
    const promptTextField = document.getElementById('promptTextField');
    const usePromptText = document.getElementById('usePromptText');
    const promptText = document.getElementById('promptText');
    const cfgEl = document.getElementById('cfg');
    const cfgVal = document.getElementById('cfgVal');
    const refFileInput = document.getElementById('refFileInput');
    const refFileName = document.getElementById('refFileName');
    const synthBtn = document.getElementById('synthesize');
    const statusEl = document.getElementById('status');
    const audioWrap = document.getElementById('audioWrap');
    const audioPlayer = document.getElementById('audioPlayer');
    const downloadWav = document.getElementById('downloadWav');
    const downloadOgg = document.getElementById('downloadOgg');

    let refBase64 = null;
    let refOrigName = null;

    modeEl.addEventListener('change', () => {
      const m = modeEl.value;
      refCard.style.display = m !== 'voice_design' ? '' : 'none';
      promptTextField.style.display = m === 'ultimate_cloning' ? '' : 'none';
    });
    modeEl.dispatchEvent(new Event('change'));

    cfgEl.addEventListener('input', () => { cfgVal.textContent = parseFloat(cfgEl.value).toFixed(1); });

    usePromptText.addEventListener('change', () => {
      promptText.style.display = usePromptText.checked ? '' : 'none';
    });

    refFileInput.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      refOrigName = file.name;
      refFileName.textContent = file.name;
      const buf = await file.arrayBuffer();
      refBase64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    });

    synthBtn.addEventListener('click', async () => {
      const text = document.getElementById('text').value.trim();
      if (!text) { showStatus('Please enter some text.', true); return; }

      synthBtn.disabled = true;
      audioWrap.style.display = 'none';
      showStatus('Generating speech… this may take 20-40 seconds.');

      const body = {
        text,
        control_instruction: document.getElementById('control').value,
        cfg_value: parseFloat(cfgEl.value),
        do_normalize: document.getElementById('normalize').checked,
        denoise: document.getElementById('denoise').checked,
        use_prompt_text: usePromptText.checked,
        prompt_text: promptText.value,
        cf_turnstile_token: 'bypass',
      };

      if (refBase64) {
        body.reference_audio_base64 = refBase64;
        body.reference_audio_name = refOrigName;
      }

      try {
        const res = await fetch('/api/tts/synthesize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: res.statusText }));
          throw new Error(err.error || 'Synthesis failed');
        }

        const blob = await res.blob();
        const wavUrl = URL.createObjectURL(blob);
        audioPlayer.src = wavUrl;
        audioWrap.style.display = '';
        downloadWav.href = wavUrl;

        // Also fetch OGG conversion
        try {
          const arrBuf = await blob.arrayBuffer();
          const oggRes = await fetch('/api/convert', {
            method: 'POST',
            headers: { 'Content-Type': 'audio/wav' },
            body: arrBuf,
          });
          if (oggRes.ok) {
            const oggBlob = await oggRes.blob();
            downloadOgg.href = URL.createObjectURL(oggBlob);
          }
        } catch (_) {}

        showStatus('Done!');
      } catch (err) {
        showStatus(err.message, true);
      } finally {
        synthBtn.disabled = false;
      }
    });

    function showStatus(msg, isError = false) {
      statusEl.textContent = msg;
      statusEl.className = 'status' + (isError ? ' error' : '');
    }
  </script>
</body>
</html>`);
});

export default router;
