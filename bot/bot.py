import os
import re
import logging
import warnings
import tempfile
import asyncio
from pathlib import Path
from typing import Optional

warnings.filterwarnings("ignore", message=".*per_message.*", category=UserWarning)

from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import (
    Application,
    CommandHandler,
    MessageHandler,
    CallbackQueryHandler,
    ConversationHandler,
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

# Conversation states
SELECT_MODE = 0
VOICE_DESIGN_TEXT = 1
CONTROL_STYLE = 2
CONTROL_TEXT = 3
CLONE_AUDIO = 4
CLONE_TEXT = 5


def main_menu_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎨 Voice Design", callback_data="mode_design")],
        [InlineKeyboardButton("🎛️ Controllable Cloning", callback_data="mode_control")],
        [InlineKeyboardButton("🎙️ Voice Cloning", callback_data="mode_clone")],
        [InlineKeyboardButton("❓ Help", callback_data="help")],
    ])


def back_keyboard():
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🔙 ត្រឡប់ Menu", callback_data="back_menu")],
    ])


async def call_voxcpm_api(
    text: str,
    control: str = "",
    ref_wav_path: Optional[str] = None,
    use_prompt_text: bool = False,
    prompt_text: str = "",
) -> str:
    loop = asyncio.get_event_loop()

    def _run():
        from gradio_client import Client, handle_file
        client = Client(HF_SPACE)
        result = client.predict(
            text_input=text,
            control_instruction=control,
            reference_wav_path_input=handle_file(ref_wav_path) if ref_wav_path else None,
            use_prompt_text=use_prompt_text,
            prompt_text_input=prompt_text,
            cfg_value_input=2.0,
            do_normalize=False,
            denoise=False,
            api_name="/generate",
        )
        return result

    result = await loop.run_in_executor(None, _run)

    if isinstance(result, dict):
        return result.get("value") or result.get("path") or result.get("url")
    if isinstance(result, (list, tuple)):
        val = result[0] if result else None
        if isinstance(val, dict):
            return val.get("value") or val.get("path") or val.get("url")
        return val
    return result


async def send_audio_result(
    update: Update,
    context: ContextTypes.DEFAULT_TYPE,
    text: str,
    control: str = "",
    ref_wav_path: Optional[str] = None,
    use_prompt_text: bool = False,
    prompt_text: str = "",
):
    try:
        audio_path = await call_voxcpm_api(
            text=text,
            control=control,
            ref_wav_path=ref_wav_path,
            use_prompt_text=use_prompt_text,
            prompt_text=prompt_text,
        )

        caption = "🎙️ *VoxCPM2*"
        if control:
            caption += f"\n🎛️ `{control}`"
        caption += f"\n📝 `{text[:100]}{'...' if len(text) > 100 else ''}`"

        if audio_path and Path(audio_path).exists():
            with open(audio_path, "rb") as af:
                await update.effective_message.reply_audio(
                    audio=af,
                    caption=caption,
                    parse_mode="Markdown",
                    title="VoxCPM2",
                    reply_markup=InlineKeyboardMarkup([
                        [InlineKeyboardButton("🔄 Generate Again", callback_data="regen")],
                        [InlineKeyboardButton("🏠 Main Menu", callback_data="back_menu")],
                    ]),
                )
        else:
            await update.effective_message.reply_text(
                "❌ ទទួល audio មិនបាន។ សូម try again ។",
                reply_markup=back_keyboard(),
            )
    except Exception as e:
        logger.error(f"Generation error: {e}", exc_info=True)
        err = str(e)
        if "429" in err or "rate" in err.lower():
            msg = "⏳ HuggingFace ជួប rate limit។ សូម try again ។"
        elif "timeout" in err.lower():
            msg = "⏳ Timeout! Model ចំណាយពេលយូរ។ try again ។"
        else:
            msg = f"❌ Error: {err[:200]}"
        await update.effective_message.reply_text(msg, reply_markup=back_keyboard())
    finally:
        if ref_wav_path and Path(ref_wav_path).exists():
            try:
                os.unlink(ref_wav_path)
            except Exception:
                pass


async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    await update.message.reply_text(
        "👋 *ស្វាគមន៍មកកាន់ VoxCPM2 Bot!*\n\n"
        "🌍 AI Text-to-Speech — 30 ភាសា\n"
        "ជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
        parse_mode="Markdown",
        reply_markup=main_menu_keyboard(),
    )
    return SELECT_MODE


async def show_main_menu(update: Update, context: ContextTypes.DEFAULT_TYPE):
    context.user_data.clear()
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "🏠 *Main Menu*\n\nជ្រើសរើស មុខងារ ដែលចង់ប្រើ:",
        parse_mode="Markdown",
        reply_markup=main_menu_keyboard(),
    )
    return SELECT_MODE


async def show_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "❓ *របៀបប្រើ VoxCPM2 Bot*\n\n"
        "🎨 *Voice Design*\n"
        "Generate audio ពី text ធម្មតា\n"
        "ឧទាហរណ៍: `Hello, welcome to VoxCPM2!`\n\n"
        "🎛️ *Controllable Cloning*\n"
        "Generate audio ជាមួយ voice style\n"
        "Style: `young woman, soft voice`\n"
        "Text: `Good morning everyone!`\n\n"
        "🎙️ *Voice Cloning*\n"
        "Clone សំឡេង ពី audio reference\n"
        "① Upload voice/audio\n"
        "② ផ្ញើ text ដែលចង់ generate\n\n"
        "🌍 *30 Languages:* EN, KH, ZH, JA, KO, FR, DE, AR, VI, TH ...",
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup([
            [InlineKeyboardButton("🔙 ត្រឡប់ Menu", callback_data="back_menu")],
        ]),
    )
    return SELECT_MODE


async def mode_design_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "🎨 *Voice Design*\n\n"
        "សរសេរ text ដែលចង់ generate audio:\n\n"
        "✏️ ឧទាហរណ៍:\n"
        "• `Hello, how are you today?`\n"
        "• `ស្វាគមន៍មកកាន់ VoxCPM2`\n"
        "• `你好，欢迎使用语音合成系统！`",
        parse_mode="Markdown",
        reply_markup=back_keyboard(),
    )
    return VOICE_DESIGN_TEXT


async def mode_design_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    if not text:
        return VOICE_DESIGN_TEXT

    status = await update.message.reply_text("⏳ *Voice Design* — កំពុង generate audio...", parse_mode="Markdown")
    await send_audio_result(update, context, text=text)
    try:
        await status.delete()
    except Exception:
        pass
    return SELECT_MODE


async def mode_control_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "🎛️ *Controllable Cloning*\n\n"
        "*ជំហាន 1:* ពណ៌នា style សំឡេង\n\n"
        "✏️ ឧទាហរណ៍:\n"
        "• `young woman, soft and gentle`\n"
        "• `old man, deep serious voice`\n"
        "• `excited teenager, fast paced`\n"
        "• `ស្ដ្រី, ទន់ភ្លន់ និងស្ងប់ស្ងាត់`\n"
        "• `年轻女性，温柔甜美`",
        parse_mode="Markdown",
        reply_markup=back_keyboard(),
    )
    return CONTROL_STYLE


async def mode_control_style(update: Update, context: ContextTypes.DEFAULT_TYPE):
    style = (update.message.text or "").strip()
    if not style:
        return CONTROL_STYLE

    context.user_data["control_style"] = style
    await update.message.reply_text(
        f"✅ Style: `{style}`\n\n"
        "*ជំហាន 2:* ឥឡូវសរសេរ text ដែលចង់ generate:\n\n"
        "✏️ ឧទាហរណ៍:\n"
        "• `Good morning! Welcome to our show.`\n"
        "• `អ្នកទស្សនាទាំងអស់គ្នា ស្វាគមន៍!`",
        parse_mode="Markdown",
        reply_markup=back_keyboard(),
    )
    return CONTROL_TEXT


async def mode_control_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    if not text:
        return CONTROL_TEXT

    control = context.user_data.get("control_style", "")
    status = await update.message.reply_text(
        f"⏳ *Controllable Cloning*\n🎛️ `{control}`\nកំពុង generate...",
        parse_mode="Markdown",
    )
    await send_audio_result(update, context, text=text, control=control)
    try:
        await status.delete()
    except Exception:
        pass
    context.user_data.clear()
    return SELECT_MODE


async def mode_clone_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_text(
        "🎙️ *Voice Cloning*\n\n"
        "*ជំហាន 1:* ផ្ញើ voice message ឬ audio file\n"
        "ដែលចង់ clone សំឡេង\n\n"
        "💡 Audio ល្អ = clone ល្អ\n"
        "• ប្រើ audio ច្បាស់, clean\n"
        "• យ៉ាងតិច 3-10 វិនាទី",
        parse_mode="Markdown",
        reply_markup=back_keyboard(),
    )
    return CLONE_AUDIO


async def mode_clone_audio(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    audio_entity = (
        msg.voice
        or msg.audio
        or (
            msg.document
            if msg.document and msg.document.mime_type and "audio" in msg.document.mime_type
            else None
        )
    )
    if not audio_entity:
        await msg.reply_text(
            "⚠️ សូម upload voice message ឬ audio file!\n"
            "មិនមែន text ទេ។",
            reply_markup=back_keyboard(),
        )
        return CLONE_AUDIO

    status = await msg.reply_text("⏳ Downloading audio...")
    file = await context.bot.get_file(audio_entity.file_id)
    with tempfile.NamedTemporaryFile(suffix=".ogg", delete=False) as tmp:
        tmp_path = tmp.name
    await file.download_to_drive(tmp_path)
    context.user_data["clone_audio_path"] = tmp_path

    try:
        await status.delete()
    except Exception:
        pass

    await msg.reply_text(
        "✅ Audio received!\n\n"
        "*ជំហាន 2:* ឥឡូវសរសេរ text ដែលចង់ generate\nដោយប្រើ សំឡេង clone នោះ:\n\n"
        "✏️ ឧទាហរណ៍:\n"
        "• `Hello, this is my cloned voice!`\n"
        "• `ឥឡូវខ្ញុំប្រើ AI ដើម្បី clone សំឡេងខ្ញុំ`",
        parse_mode="Markdown",
        reply_markup=back_keyboard(),
    )
    return CLONE_TEXT


async def mode_clone_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    text = (update.message.text or "").strip()
    if not text:
        return CLONE_TEXT

    ref_wav = context.user_data.get("clone_audio_path")
    if not ref_wav or not Path(ref_wav).exists():
        await update.message.reply_text(
            "❌ Audio file ខូច ឬ expired។ សូម upload ម្ដងទៀត។",
            reply_markup=back_keyboard(),
        )
        return SELECT_MODE

    status = await update.message.reply_text("⏳ *Voice Cloning* — កំពុង clone ហើយ generate...", parse_mode="Markdown")
    await send_audio_result(update, context, text=text, ref_wav_path=ref_wav)
    try:
        await status.delete()
    except Exception:
        pass
    context.user_data.clear()
    return SELECT_MODE


async def handle_regen(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    await query.edit_message_caption(
        caption=query.message.caption or "",
        reply_markup=None,
    )
    await query.message.reply_text(
        "🔄 ចង់ generate ម្ដងទៀត?\nជ្រើសរើស mode:",
        reply_markup=main_menu_keyboard(),
    )
    return SELECT_MODE


async def fallback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "ជ្រើសរើស mode ពី menu:",
        reply_markup=main_menu_keyboard(),
    )
    return SELECT_MODE


async def handle_back_in_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Handle 'back' text (non-callback) gracefully."""
    await update.message.reply_text(
        "🏠 *Main Menu*\n\nជ្រើសរើស មុខងារ:",
        parse_mode="Markdown",
        reply_markup=main_menu_keyboard(),
    )
    context.user_data.clear()
    return SELECT_MODE


def main():
    app = Application.builder().token(BOT_TOKEN).build()

    conv = ConversationHandler(
        entry_points=[CommandHandler("start", cmd_start)],
        states={
            SELECT_MODE: [
                CallbackQueryHandler(mode_design_start, pattern="^mode_design$"),
                CallbackQueryHandler(mode_control_start, pattern="^mode_control$"),
                CallbackQueryHandler(mode_clone_start, pattern="^mode_clone$"),
                CallbackQueryHandler(show_help, pattern="^help$"),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
                CallbackQueryHandler(handle_regen, pattern="^regen$"),
            ],
            VOICE_DESIGN_TEXT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, mode_design_text),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
            ],
            CONTROL_STYLE: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, mode_control_style),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
            ],
            CONTROL_TEXT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, mode_control_text),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
            ],
            CLONE_AUDIO: [
                MessageHandler(filters.VOICE | filters.AUDIO | filters.Document.AUDIO, mode_clone_audio),
                MessageHandler(filters.TEXT & ~filters.COMMAND, lambda u, c: u.message.reply_text(
                    "⚠️ សូម upload audio file!\nមិនមែន text ទេ។", reply_markup=back_keyboard()
                ) or CLONE_AUDIO),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
            ],
            CLONE_TEXT: [
                MessageHandler(filters.TEXT & ~filters.COMMAND, mode_clone_text),
                CallbackQueryHandler(show_main_menu, pattern="^back_menu$"),
            ],
        },
        fallbacks=[
            CommandHandler("start", cmd_start),
            MessageHandler(filters.ALL, fallback),
        ],
        per_message=False,
    )

    app.add_handler(conv)

    logger.info("VoxCPM2 Telegram Bot started!")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
