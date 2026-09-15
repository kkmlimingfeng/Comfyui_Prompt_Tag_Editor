import re


def parse_prompt(prompt):
    result = []
    current = []
    depth = 0

    for ch in prompt or "":
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth = max(0, depth - 1)

        if ch == "," and depth == 0:
            item = "".join(current).strip()
            if item:
                result.append(parse_tag(item))
            current = []
        else:
            current.append(ch)

    item = "".join(current).strip()
    if item:
        result.append(parse_tag(item))

    return result


def parse_tag(text):
    body = text.strip()
    weight = 1.0

    m = re.fullmatch(r"\((.*):([0-9]*\.?[0-9]+)\)", body)
    if m:
        body = m.group(1).strip()
        weight = float(m.group(2))
    elif body.startswith("((") and body.endswith("))"):
        body = body[2:-2].strip()
        weight = 1.21
    elif body.startswith("(") and body.endswith(")"):
        body = body[1:-1].strip()
        weight = 1.1

    return {
        "id": None,
        "text": body,
        "translation": "",
        "weight": weight,
    }


def serialize_prompt(tags):
    result = []

    for tag in tags:
        text = str(tag.get("text", "")).strip()
        if not text:
            continue

        weight = float(tag.get("weight", 1.0))
        if abs(weight - 1.0) < 1e-6:
            result.append(text)
        else:
            result.append(f"({text}:{weight:g})")

    return ", ".join(result)
