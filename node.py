import json
from pathlib import Path
from aiohttp import web

from comfy_api.latest import ComfyExtension, io
from server import PromptServer

from .prompt_parser import parse_prompt, serialize_prompt
from .translator import translate_tags, get_model_status


def load_saved_tags(raw):
    """Parse the frontend's tags_state JSON. Returns None when unusable."""
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(data, list):
        return None
    tags = []
    for item in data:
        if not isinstance(item, dict):
            return None
        try:
            weight = float(item.get("weight", 1.0))
        except (TypeError, ValueError):
            return None
        tags.append({
            "text": str(item.get("text", "")).strip(),
            "translation": str(item.get("translation", "") or ""),
            "weight": weight,
            "disabled": bool(item.get("disabled", False)),
        })
    return tags


class PromptTagEditor(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="PromptTagEditor",
            display_name="Prompt Tag Editor",
            category="Prompt Tools",
            description="Interactive synchronized prompt/tag editor with optional Hy-MT2 translation.",
            inputs=[
                io.String.Input(
                    "prompt",
                    default="",
                    multiline=True,
                    tooltip="Original prompt. Tags are separated by commas.",
                ),
                io.String.Input(
                    "translated_prompt",
                    default="",
                    multiline=True,
                    tooltip="Translated tags. Kept in sync by the frontend editor UI.",
                ),
                io.Combo.Input(
                    "target_language",
                    options=[
                        "Chinese", "Japanese", "Korean", "English",
                        "French", "German", "Spanish", "Russian",
                    ],
                    default="Chinese",
                    tooltip="Language used by the translation result Tags.",
                ),
                io.String.Input(
                    "tags_state",
                    default="",
                    tooltip="Internal editor state (tags JSON). Managed by the frontend UI; do not edit.",
                ),
            ],
            outputs=[
                io.String.Output("prompt", display_name="Prompt"),
                io.String.Output("translated_prompt", display_name="Translated Prompt"),
                io.String.Output("tags_json", display_name="Tags JSON"),
            ],
        )

    @classmethod
    def execute(cls, prompt, translated_prompt, target_language, tags_state=""):
        tags = parse_prompt(prompt)
        # When tags_state is consistent with the prompt text, prefer it: it
        # carries weights, translations and disabled flags.
        saved = load_saved_tags(tags_state)
        if saved is not None:
            enabled = [t for t in saved if not t["disabled"]]
            if serialize_prompt(enabled) == serialize_prompt(tags):
                tags = saved
        return io.NodeOutput(
            serialize_prompt(tags),
            translated_prompt or "",
            json.dumps(tags, ensure_ascii=False),
        )


class PromptTagEditorExtension(ComfyExtension):
    async def get_node_list(self):
        return [PromptTagEditor]


@PromptServer.instance.routes.post("/prompt_tag_editor/translate")
async def prompt_tag_editor_translate(request):
    try:
        data = await request.json()
        tags = data.get("tags", [])
        language = data.get("target_language", "Chinese")

        texts = [str(t.get("text", "")).strip() for t in tags]
        translations = await translate_tags(texts, language)

        return web.json_response({
            "ok": True,
            "translations": translations,
            "model_status": get_model_status(),
        })
    except Exception as exc:
        return web.json_response({
            "ok": False,
            "error": str(exc),
            "model_status": get_model_status(),
        }, status=500)


@PromptServer.instance.routes.get("/prompt_tag_editor/status")
async def prompt_tag_editor_status(request):
    return web.json_response(get_model_status())
