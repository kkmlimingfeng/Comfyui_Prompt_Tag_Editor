from .node import PromptTagEditor, LoadImageFromPath, PromptTagEditorExtension

# Required so ComfyUI registers ./web and serves prompt_tag_editor.js to the frontend.
WEB_DIRECTORY = "./web"

async def comfy_entrypoint():
    return PromptTagEditorExtension()
