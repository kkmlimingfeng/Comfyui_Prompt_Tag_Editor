from pathlib import Path
import asyncio
import os
import re
import urllib.request

_llm = None
_model_path = None
_lock = asyncio.Lock()
_cache = {}

MODEL_DIR_NAME = "Hy-MT2-1.8B-GGUF"
MODEL_FILENAME = "Hy-MT2-1.8B-Q4_K_M.gguf"
DOWNLOAD_URLS = [
    f"https://huggingface.co/tencent/{MODEL_DIR_NAME}/resolve/main/{MODEL_FILENAME}",
    f"https://hf-mirror.com/tencent/{MODEL_DIR_NAME}/resolve/main/{MODEL_FILENAME}",
]

_download_state = {
    "downloading": False,
    "downloaded": 0,
    "total": 0,
    "error": None,
    "source": None,
}


def _comfyui_dir():
    # custom_nodes/<this plugin>/translator.py -> ComfyUI root
    return Path(__file__).resolve().parent.parent.parent


def _model_dir():
    return _comfyui_dir() / "models" / "text_translation" / MODEL_DIR_NAME


def find_model():
    model_dir = _model_dir()

    candidates = sorted(model_dir.glob("*Q4_K_M*.gguf"))
    if not candidates:
        candidates = sorted(model_dir.glob("*.gguf"))

    return candidates[0] if candidates else None


def expected_model_path():
    return _model_dir() / MODEL_FILENAME


def _download_model(dest):
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_name(dest.name + ".part")
    last_err = None

    for url in DOWNLOAD_URLS:
        try:
            _download_state.update(
                downloading=True, downloaded=0, total=0, error=None, source=url
            )
            req = urllib.request.Request(
                url, headers={"User-Agent": "comfyui-prompt-tag-editor"}
            )
            with urllib.request.urlopen(req, timeout=30) as resp, open(tmp, "wb") as f:
                total = int(resp.headers.get("Content-Length") or 0)
                _download_state["total"] = total
                done = 0
                while True:
                    chunk = resp.read(1024 * 1024)
                    if not chunk:
                        break
                    f.write(chunk)
                    done += len(chunk)
                    _download_state["downloaded"] = done

            if total and done < total:
                raise RuntimeError(f"incomplete download {done}/{total} bytes")

            os.replace(tmp, dest)  # atomic move once fully downloaded
            _download_state.update(downloading=False, error=None)
            return dest
        except Exception as exc:
            last_err = exc
            _download_state["error"] = str(exc)
            continue

    try:
        tmp.unlink()
    except OSError:
        pass
    _download_state["downloading"] = False
    raise RuntimeError(f"model download failed: {last_err}")


def get_model_status():
    path = find_model()
    return {
        "model_found": path is not None,
        "model_loaded": _llm is not None,
        "model_path": str(path) if path else None,
        "cuda_layers": -1,
        "download": dict(_download_state),
    }


def _load_model():
    global _llm, _model_path

    path = find_model()
    if path is None:
        # Auto-download from Hugging Face (hf-mirror.com fallback).
        path = _download_model(expected_model_path())

    if _llm is not None and _model_path == str(path):
        return _llm

    from llama_cpp import Llama

    _llm = Llama(
        model_path=str(path),
        n_gpu_layers=-1,
        n_ctx=4096,
        verbose=False,
    )
    _model_path = str(path)
    return _llm


def _translate_one(llm, text, target_language):
    # Same prompt shape the standalone label-editor app uses with this model;
    # short segments translate cleanly one at a time.
    prompt = (
        f"Translate the following segment into {target_language}, "
        f"without additional explanation.\n\n{text}"
    )
    response = llm.create_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=128,
    )
    return response["choices"][0]["message"]["content"].strip()


def _translate_batch(llm, texts, target_language):
    numbered = "\n".join(
        f"{i + 1}. {text}" for i, text in enumerate(texts)
    )

    prompt = (
        f"Translate the following image-generation prompt tags into "
        f"{target_language}. Preserve the exact number and order of items. "
        "Translate each item as a concise tag. Return ONLY the translated "
        "items, one per line, with no numbering and no explanation.\n\n"
        f"{numbered}"
    )

    response = llm.create_chat_completion(
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=max(128, len(texts) * 32),
    )

    content = response["choices"][0]["message"]["content"].strip()
    lines = [x.strip() for x in content.splitlines() if x.strip()]

    # Remove accidental numbering such as "1. xxx".
    cleaned = []
    for line in lines:
        line = re.sub(r"^\s*\d+\s*[\.\):\-]\s*", "", line)
        cleaned.append(line.strip())

    return cleaned


def _translate_sync(texts, target_language):
    llm = _load_model()

    results = [None] * len(texts)

    # 1) Serve cached entries first.
    pending = []
    for i, text in enumerate(texts):
        cached = _cache.get((target_language, text))
        if cached:
            results[i] = cached
        else:
            pending.append(i)

    if not pending:
        return results

    # 2) Try one batched request for the remaining items.
    try:
        batch_texts = [texts[i] for i in pending]
        cleaned = _translate_batch(llm, batch_texts, target_language)
        if len(cleaned) == len(pending) and all(cleaned):
            for i, out in zip(pending, cleaned):
                results[i] = out
                _cache[(target_language, texts[i])] = out
            pending = []
    except Exception:
        pass

    # 3) Fallback: translate each remaining item individually so the count
    # always stays aligned, even if the model merged lines in the batch.
    for i in pending:
        try:
            out = _translate_one(llm, texts[i], target_language)
        except Exception:
            out = ""
        out = out.strip()
        if out:
            _cache[(target_language, texts[i])] = out
        results[i] = out

    return results


async def translate_tags(texts, target_language):
    if not texts:
        return []

    async with _lock:
        return await asyncio.to_thread(
            _translate_sync,
            texts,
            target_language,
        )
