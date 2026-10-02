import json
import os
from pathlib import Path
from aiohttp import web

import numpy as np
import torch
from PIL import Image, ImageOps, ImageSequence

import comfy.model_management
import folder_paths
import node_helpers
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
        return [PromptTagEditor, LoadImageFromPath]


# ---- load image from path -------------------------------------------------

_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp", ".tif", ".tiff"}


def resolve_image_path(raw):
    """Resolve a user-supplied path to an existing image file.

    Absolute paths are used as-is. Relative paths are tried against the
    input directory, the output directory and the ComfyUI base folder.
    Raises ValueError with a user-facing message when unusable.
    """
    path = str(raw).strip().strip('"').strip("'").strip()
    if not path:
        raise ValueError("Image path is empty.")

    candidates = [path]
    if not os.path.isabs(path):
        for base in (folder_paths.get_input_directory(),
                     folder_paths.get_output_directory(),
                     folder_paths.base_path):
            candidates.append(os.path.join(base, path))

    for cand in candidates:
        cand = os.path.abspath(cand)
        if os.path.isfile(cand):
            if os.path.splitext(cand)[1].lower() not in _IMAGE_EXTENSIONS:
                raise ValueError(f"Not a supported image file: {cand}")
            return cand
    raise ValueError(f"Image file not found: {path}")


class LoadImageFromPath(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="LoadImageFromPath",
            display_name="Load Image From Path",
            category="Prompt Tools",
            description="Load an image (and optional alpha mask) from an arbitrary file path.",
            inputs=[
                io.String.Input(
                    "image_path",
                    default="",
                    tooltip="Image file path. Absolute path, or relative to the input / output / ComfyUI folders.",
                ),
            ],
            outputs=[
                io.Image.Output(),
                io.Mask.Output(),
            ],
        )

    @classmethod
    def validate_inputs(cls, image_path):
        try:
            resolve_image_path(image_path)
        except ValueError as exc:
            return str(exc)
        return True

    @classmethod
    def fingerprint_inputs(cls, image_path):
        try:
            path = resolve_image_path(image_path)
        except ValueError:
            return str(image_path)
        try:
            return f"{path}:{os.path.getmtime(path)}"
        except OSError:
            return path

    @classmethod
    def execute(cls, image_path):
        path = resolve_image_path(image_path)

        dtype = comfy.model_management.intermediate_dtype()
        device = comfy.model_management.intermediate_device()

        img = node_helpers.pillow(Image.open, path)

        # Same loading logic as the core LoadImage node: EXIF-aware,
        # animated files are flattened to same-size frames, alpha becomes
        # an inverted mask, frames without alpha get an empty mask.
        output_images = []
        output_masks = []
        w = h = None
        for i in ImageSequence.Iterator(img):
            i = node_helpers.pillow(ImageOps.exif_transpose, i)
            image = i.convert("RGB")
            if w is None:
                w, h = image.size
            if image.size[0] != w or image.size[1] != h:
                continue
            image = np.array(image).astype(np.float32) / 255.0
            output_images.append(torch.from_numpy(image)[None, ])
            if "A" in i.getbands():
                mask = np.array(i.getchannel("A")).astype(np.float32) / 255.0
                output_masks.append((1.0 - torch.from_numpy(mask)).unsqueeze(0))
            else:
                output_masks.append(torch.zeros((1, 64, 64), dtype=torch.float32))

        if not output_images:
            raise ValueError(f"Could not read any frames from image: {path}")

        output_image = torch.cat(output_images, dim=0).to(device=device, dtype=dtype)
        output_mask = torch.cat(output_masks, dim=0).to(device=device, dtype=dtype)
        return io.NodeOutput(output_image, output_mask)


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


@PromptServer.instance.routes.get("/prompt_tag_editor/browse")
async def prompt_tag_editor_browse(request):
    """List directories and image files for the frontend path picker.

    `path` = directory to list; empty → input directory;
    `__drives__` → drive list (Windows). Only names/paths are returned,
    no file contents.
    """
    raw = request.query.get("path", "").strip()
    try:
        if raw == "__drives__":
            drives = [f"{letter}:\\" for letter in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
                      if os.path.exists(f"{letter}:\\")]
            return web.json_response({
                "ok": True, "path": "此电脑（所有盘符）", "parent": "",
                "dirs": [{"name": d, "path": d} for d in drives], "files": [],
            })

        path = os.path.abspath(raw or folder_paths.get_input_directory())
        if not os.path.isdir(path):
            return web.json_response(
                {"ok": False, "error": f"目录不存在: {path}"}, status=400)

        dirs, files = [], []
        try:
            with os.scandir(path) as it:
                for entry in it:
                    try:
                        if entry.is_dir():
                            dirs.append({"name": entry.name, "path": entry.path})
                        elif entry.is_file() and os.path.splitext(entry.name)[1].lower() in _IMAGE_EXTENSIONS:
                            files.append({"name": entry.name, "path": entry.path})
                    except OSError:
                        continue  # unreadable entry (e.g. Windows junction)
        except (PermissionError, OSError) as exc:
            return web.json_response(
                {"ok": False, "error": f"无法读取目录 {path}: {exc}"}, status=400)

        parent = os.path.dirname(path)
        if parent == path:
            parent = "__drives__"
        dirs.sort(key=lambda d: d["name"].lower())
        files.sort(key=lambda f: f["name"].lower())
        return web.json_response({
            "ok": True, "path": path, "parent": parent, "dirs": dirs, "files": files,
        })
    except Exception as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=500)


_CONTENT_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".webp": "image/webp", ".gif": "image/gif", ".bmp": "image/bmp",
    ".tif": "image/tiff", ".tiff": "image/tiff",
}


@PromptServer.instance.routes.get("/prompt_tag_editor/view")
async def prompt_tag_editor_view(request):
    """Serve an image file's content for the path picker's preview thumbnail."""
    raw = request.query.get("path", "")
    try:
        path = resolve_image_path(raw)
    except ValueError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    try:
        if os.path.getsize(path) > 64 * 1024 * 1024:
            return web.json_response(
                {"ok": False, "error": "文件过大，无法预览（>64MB）"}, status=400)
        with open(path, "rb") as f:
            body = f.read()
    except OSError as exc:
        return web.json_response({"ok": False, "error": str(exc)}, status=400)
    ext = os.path.splitext(path)[1].lower()
    return web.Response(
        body=body,
        content_type=_CONTENT_TYPES.get(ext, "application/octet-stream"),
        headers={"Cache-Control": "no-cache"},
    )
