import os
import re
import logging
import tempfile
import asyncio
from pathlib import Path
from typing import Optional

from telegram import Update
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    ContextTypes,
    filters,
)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
if not BOT_TOKEN:
    raise RuntimeError("TELEGRAM_BOT_TOKEN environment variable is not set.")

HF_SPACE = "OpenBMB/VoxCPM-Demo"


def parse_message(text: str):
    """Parse [control: ...] text format."""
    control = ""
    clean_text = text.strip()
    match = re.match(r"^\[control:\s*(.*?)\]\s*(.+)$", clean_text, re.DOTALL | re.IGNORECASE)
    if match:
        control = match.group(1).strip()
        clean_text = match.group(2).strip()
    return control, clean_text


async def call_voxcpm_api(
    text: str,
    control: str = "",
    ref_wav_path: Optional[str] = None,
    use_prompt_text: bool = False,
    prompt_text: str = "",
) -> str:
    """Call VoxCPM2 HuggingFace Space API. Returns path to generated audio file."""
    loop = asyncio.get_event_loop()

    def _run():
        from gradio_client import Client, handle_file

        client = Client(HF_SPACE)

        kwargs = {
            "text_input": text,
            "control_instruction": control,
            "reference_wav_path_input": handle_file(ref_wav_path) if ref_wav_path else None,
            "use_prompt_text": use_prompt_text,
            "prompt_text": prompt_text,
            "cfg_value_input": 2.0,
            "do_normalize": False,
            "denoise": False,
            "dit_steps": 10,
            "api_name": "/generate",
        }

        result = client.predict(**kwargs)
        return result

    result = await loop.run_in_executor(None, _run)

    if isinstance(result, dict) and "value" in result:
        return result["value"]
    if isinstance(result, (list, tuple)):
        val = result[0] if result else None
        if isinstance(val, dict):
            return val.get("value") or val.get("path") or val.get("url")
        return val
    return result


HELP_TEXT = """
🎙️ *VoxCPM2 Telegram Bot*

AI Text-to-Speech ដែលគាំទ្រ 30 ភាសា
English, ខ្មែរ, 中文, 日本語, 한국어 ...

━━━━━━━━━━━━━━━━━━━━━━
📖 *របៀបប្រើ:*

*1️⃣ Voice Design — generate audio ពី text*
ផ្ញើ text ណាមួយ ហើយ bot ផ្ញើ audio ត្រឡប់

  ✏️ `Hello, how are you today?`
  ✏️ `ស្វាគមន៍មកកាន់ VoxCPM2`

*2️⃣ Control Style — បញ្ជាក់ style សំឡេង*
Format: `[control: description] your text`

  ✏️ `[control: young woman, soft voice] Welcome!`
  ✏️ `[control: old man, deep] Hello world.`
  ✏️ `[control: excited, fast paced] Amazing!`
  ✏️ `[control: ស្ដ្រី, ទន់ភ្លន់] ស្វាគមន៍!`
  ✏️ `[control: 年轻女性，温柔] 你好！`

*3️⃣ Voice Cloning — clone សំឡេង*
① ផ្ញើ voice message ឬ audio file
② Reply ទៅ message នោះ + text ដែលចង់ generate

━━━━━━━━━━━━━━━━━━━━━━
⚡ *Powered by HuggingFace Spaces*
🌍 *30 Languages Supported*

/start — ចាប់ផ្ដើម
/help — ការណែនាំ
"""

START_TEXT = """
👋 *ស្វាគមន៍មកកាន់ VoxCPM2 Bot!*

🎙️ AI Text-to-Speech ដែលអាច:
• 🎨 *Voice Design* — generate audio ពី text
• 🎛️ *Control Style* — `[control: young woman] text`
• 🎙️ *Voice Cloning* — ផ្ញើ audio → reply ជាមួយ text

ផ្ញើ text ណាមួយ ដើម្បី generate audio!
ឬ /help ដើម្បីមើល instructions ពេញ។

🌍 *30 Languages:* EN, KH, ZH, JA, KO, FR, DE, AR, VI, TH...
"""


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(START_TEXT, parse_mode="Markdown")


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(HELP_TEXT, parse_mode="Markdown")


async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle text messages — generate TTS via HuggingFace API."""
    msg = update.message
    text = (msg.text or "").strip()
    if not text or text.startswith("/"):
        return

    control, clean_text = parse_message(text)

    ref_wav_path = None
    use_prompt_text = False

    if msg.reply_to_message:
        replied = msg.reply_to_message
        audio_entity = (
            replied.voice
            or replied.audio
            or (
                replied.document
                if replied.document
                and replied.document.mime_type
                and "audio" in replied.document.mime_type
                else None
            )
        )
        if audio_entity:
            status_msg = await msg.reply_text("⏳ Downloading audio ហើយ clone សំឡេង...")
            file = await context.bot.get_file(audio_entity.file_id)
            with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
                ref_wav_path = tmp.name
            await file.download_to_drive(ref_wav_path)
        else:
            status_msg = await msg.reply_text("⏳ កំពុង generate audio...")
    else:
        mode = f"🎛️ _{control}_\n" if control else ""
        status_msg = await msg.reply_text(f"⏳ {mode}កំពុង generate audio...")

    try:
        audio_path = await call_voxcpm_api(
            text=clean_text,
            control=control,
            ref_wav_path=ref_wav_path,
            use_prompt_text=use_prompt_text,
        )

        caption = "🎙️ *VoxCPM2*"
        if control:
            caption += f"\n🎛️ `{control}`"
        caption += f"\n📝 `{clean_text[:100]}{'...' if len(clean_text) > 100 else ''}`"

        if audio_path and Path(audio_path).exists():
            with open(audio_path, "rb") as audio_file:
                await msg.reply_audio(
                    audio=audio_file,
                    caption=caption,
                    parse_mode="Markdown",
                    title="VoxCPM2",
                )
        else:
            await msg.reply_text("❌ ទទួល audio មិនបាន។ សូម try again ។")

        try:
            await status_msg.delete()
        except Exception:
            pass

    except Exception as e:
        logger.error(f"Generation error: {e}", exc_info=True)
        err_text = str(e)
        if "429" in err_text or "rate" in err_text.lower():
            msg_text = "⏳ HuggingFace Space ជួប rate limit។ សូម try again បន្តិចទៀត។"
        elif "timeout" in err_text.lower():
            msg_text = "⏳ Timeout! Model ចំណាយពេលយូរ។ សូម try again ។"
        else:
            msg_text = f"❌ Error: {err_text[:200]}\n\nSούm try again ។"
        try:
            await status_msg.edit_text(msg_text)
        except Exception:
            await msg.reply_text(msg_text)
    finally:
        if ref_wav_path and Path(ref_wav_path).exists():
            try:
                os.unlink(ref_wav_path)
            except Exception:
                pass


async def handle_audio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle audio/voice uploads — prompt user to reply with text."""
    await update.message.reply_text(
        "🎤 *Audio received!*\n\n"
        "ឥឡូវ *reply* ទៅ message នេះ ជាមួយ text ដែលចង់ generate\n"
        "Bot នឹង clone សំឡេងរបស់អ្នក ហើយ speak text នោះ។\n\n"
        "✏️ ឧទាហរណ៍: `Hello, this is my cloned voice speaking!`",
        parse_mode="Markdown",
    )


def main():
    app = Application.builder().token(BOT_TOKEN).build()

    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    app.add_handler(
        MessageHandler(
            filters.VOICE | filters.AUDIO | filters.Document.AUDIO,
            handle_audio,
        )
    )

    logger.info("VoxCPM2 Telegram Bot started!")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
