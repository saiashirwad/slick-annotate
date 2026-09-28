#!/usr/bin/env python3
"""Read-only walk authoring checks. Python 3.9+, standard library only.

Schema rules mirror src/walk-data.ts and src/validation.ts in Tandem.
Diff lines follow src/walk-diff.ts, with additional source and hunk checks.
Markdown links follow the click handler in media/walk.js: split on the first `#`, then decode.
"""

import argparse
import json
import re
import sys
from pathlib import Path
from urllib.parse import unquote


def fields(value, required, optional, where, errors):
    if not isinstance(value, dict):
        errors.append(f"{where}: expected an object")
        return False
    valid = True
    for name, kind in {**required, **optional}.items():
        if name not in value and name in required:
            errors.append(f"{where}: missing {name}")
            valid = False
        elif name in value and type(value[name]) is not kind:
            errors.append(f"{where}.{name}: expected {kind.__name__}")
            valid = False
    for name in value.keys() - required.keys() - optional.keys():
        errors.append(f"{where}: unknown field {name!r}")
        valid = False
    return valid


def valid_path(value):
    return (
        bool(value)
        and not re.match(r"^(?:[/\\]|[a-z]:)", value, re.I)
        and ".." not in re.split(r"[/\\]", value)
        and "\0" not in value
    )


def schema_errors(walk):
    errors = []
    if not fields(walk, {"title": str, "steps": list}, {"$schema": str}, "Walk", errors):
        return errors
    ids = set()
    for index, step in enumerate(walk["steps"]):
        where = f"Step {index + 1}"
        if not fields(
            step,
            {"id": str, "title": str, "body": str},
            {"details": str, "file": str, "quote": str, "refs": list, "proposal": bool, "diff": str},
            where,
            errors,
        ):
            continue
        where = f"Step {step['id']!r}"
        if not step["id"]:
            errors.append(f"{where}: id must not be empty")
        if step["id"] in ids:
            errors.append(f"{where}: duplicate id")
        ids.add(step["id"])
        if "quote" in step and "file" not in step:
            errors.append(f"{where}: a quote requires a file")
        if "diff" in step and step.get("proposal") is not True:
            errors.append(f"{where}: a diff requires proposal: true")
        anchors = [(where, step)]
        for ref_index, ref in enumerate(step.get("refs", [])):
            ref_where = f"{where}, ref {ref_index + 1}"
            if fields(ref, {"file": str}, {"quote": str, "label": str}, ref_where, errors):
                anchors.append((ref_where, ref))
        for location, anchor in anchors:
            if "file" in anchor and not valid_path(anchor["file"]):
                errors.append(f"{location}: expected a path inside the workspace")
            if "quote" in anchor and not anchor["quote"]:
                errors.append(f"{location}: quote must not be empty")
    return errors


def source_path(root, name):
    if not valid_path(name):
        raise ValueError(f"expected a workspace-relative path, got {name!r}")
    if "\\" in name:
        raise ValueError(f"use '/' separators in {name!r}")
    path = (root / name).resolve()
    try:
        path.relative_to(root)
    except ValueError:
        raise ValueError(f"{name!r} resolves outside the workspace") from None
    return path


def source_text(path):
    # VS Code excludes the encoding BOM from document text; preserve CRLF for quotes.
    with path.open(encoding="utf-8-sig", newline="") as source:
        return source.read()


def quote_count(text, quote):
    count = 0
    at = text.find(quote)
    while at != -1:
        count += 1
        at = text.find(quote, at + 1)
    return count


def header_path(line, prefix):
    name = line[4:].split("\t", 1)[0]
    return name[len(prefix):] if name.startswith(prefix) else name


def check_diff(step, root):
    lines = [line.removesuffix("\r") for line in step["diff"].removesuffix("\n").split("\n")]
    before_name = after_name = step.get("file")
    if lines[0].startswith(("--- ", "+++ ")):
        if len(lines) < 2 or not lines[0].startswith("--- ") or not lines[1].startswith("+++ "):
            raise ValueError("use paired --- and +++ file headers")
        before_name = header_path(lines[0], "a/")
        after_name = header_path(lines[1], "b/")
        lines = lines[2:]
    if before_name is None or after_name is None:
        raise ValueError("set file for an existing-file diff, or provide ---/+++ headers")
    creating = before_name == "/dev/null"
    deleting = after_name == "/dev/null"
    if creating and deleting:
        raise ValueError("both diff paths are /dev/null")
    if not creating and not deleting and before_name != after_name:
        raise ValueError("one diff previews one file; describe moves in the proposal")
    target = after_name if creating else before_name
    if "file" in step and step["file"] != target:
        raise ValueError(f"diff target {target!r} differs from step.file {step['file']!r}")
    path = source_path(root, target)
    if creating and path.exists():
        raise ValueError(f"creation target {target!r} already exists")
    source = [] if creating else source_text(path).splitlines()

    groups = []
    header = None
    rows = []
    for index, line in enumerate(lines):
        if line.startswith("diff --git ") or re.match(r"^index [0-9a-f]+\.\.[0-9a-f]+", line):
            raise ValueError("omit Git metadata; Tandem displays it as source context")
        if line.startswith("--- ") and index + 1 < len(lines) and lines[index + 1].startswith("+++ "):
            raise ValueError("multiple file diffs; one diff previews one file")
        if line.startswith("@@"):
            if rows or header is not None:
                groups.append((header, rows))
            header, rows = line, []
        elif not line.startswith("\\"):
            rows.append(line)
    if rows or header is not None:
        groups.append((header, rows))

    last_end = 0
    delta = 0
    changed = False
    removed = []
    for number, (header, rows) in enumerate(groups, 1):
        before, after = [], []
        for line in rows:
            if line.startswith("+"):
                after.append(line[1:])
                changed = True
            elif line.startswith("-"):
                before.append(line[1:])
                changed = True
            else:
                context = line[1:] if line.startswith(" ") else line
                before.append(context)
                after.append(context)
        numeric = re.fullmatch(r"@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@.*", header or "")
        if header and header.startswith("@@ -") and numeric is None:
            raise ValueError(f"hunk {number}: malformed numeric header {header!r}")
        if numeric:
            old_start, old_count, new_start, new_count = numeric.groups()
            old_count, new_count = int(old_count or 1), int(new_count or 1)
            if (old_count, new_count) != (len(before), len(after)):
                raise ValueError(
                    f"hunk {number}: header declares {old_count} before/{new_count} after lines; "
                    f"found {len(before)} before/{len(after)} after"
                )
            position = int(old_start) - (1 if old_count else 0)
            new_position = int(new_start) - (1 if new_count else 0)
            if new_position < 0 or new_position != position + delta:
                raise ValueError(f"hunk {number}: new line position disagrees with preceding edits")
        elif before:
            matches = [
                index for index in range(len(source) - len(before) + 1)
                if source[index:index + len(before)] == before
            ]
            if len(matches) != 1:
                raise ValueError(f"hunk {number}: before-text occurs {len(matches)} times in {target}")
            position = matches[0]
        elif creating:
            position = 0
        else:
            raise ValueError(f"hunk {number}: insertion needs source context or a numeric position")
        if creating and before:
            raise ValueError(f"hunk {number}: a creation diff cannot have before-text")
        if deleting and after:
            raise ValueError(f"hunk {number}: a deletion diff cannot have after-text")
        if position < last_end or position > len(source):
            raise ValueError(f"hunk {number}: source range overlaps, is out of order, or is outside {target}")
        if source[position:position + len(before)] != before:
            raise ValueError(f"hunk {number}: before-text does not match {target} at line {position + 1}")
        last_end = position + len(before)
        delta += len(after) - len(before)
        removed.extend(before)
    if not changed:
        raise ValueError("diff contains no added or removed lines")
    if deleting and removed != source:
        raise ValueError("a deletion diff must include the whole file")


PUNCT = set('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~')


def line_start(text, index):
    return index == 0 or text[index - 1] == "\n"


def skip_code_span(text, index):
    length = 0
    while index + length < len(text) and text[index + length] == "`":
        length += 1
    if length == 0:
        return index + 1
    close = text.find("`" * length, index + length)
    return len(text) if close == -1 else close + length


def fence_open(text, index):
    if not line_start(text, index):
        return None
    indent = 0
    while index + indent < len(text) and text[index + indent] == " " and indent < 4:
        indent += 1
    if indent > 3:
        return None
    at = index + indent
    if at >= len(text) or text[at] not in "`~":
        return None
    marker = text[at]
    length = 0
    while at + length < len(text) and text[at + length] == marker:
        length += 1
    if length < 3:
        return None
    line_end = text.find("\n", at + length)
    if line_end == -1:
        line_end = len(text)
    if marker == "`" and "`" in text[at + length:line_end]:
        return None
    return marker, length, line_end + 1


def skip_fence(text, index):
    opened = fence_open(text, index)
    if opened is None:
        return index + 1
    marker, length, at = opened
    while at < len(text):
        close = fence_open(text, at)
        if close and close[0] == marker and close[1] >= length:
            line_end = text.find("\n", at)
            if line_end == -1:
                line_end = len(text)
            indent = len(text[at:line_end]) - len(text[at:line_end].lstrip(" "))
            if text[at + indent + close[1]:line_end].strip() == "":
                return close[2]
        newline = text.find("\n", at)
        at = len(text) if newline == -1 else newline + 1
    return len(text)


def take_escape(text, index, buf):
    if text[index] == "\\" and index + 1 < len(text) and text[index + 1] in PUNCT:
        buf.append(text[index + 1])
        return index + 2
    return None


def link_label(text):
    cleaned = re.sub(r"[`*_]+", "", text)
    cleaned = " ".join(cleaned.split())
    if not cleaned:
        return None
    return cleaned if len(cleaned) <= 40 else cleaned[:37] + "..."


def label_end(text, index):
    while index < len(text):
        escaped = take_escape(text, index, [])
        if escaped is not None:
            index = escaped
            continue
        if text[index] == "`":
            index = skip_code_span(text, index)
            continue
        if text[index] == "[":
            nested = label_end(text, index + 1)
            if nested is None:
                return None
            index = nested
            continue
        if text[index] == "]":
            return index + 1
        index += 1
    return None


def destination_close(text, index):
    while index < len(text) and text[index] in " \t\n":
        index += 1
    if index < len(text) and text[index] in "\"'":
        quote = text[index]
        index += 1
        while index < len(text) and text[index] != quote:
            index += 2 if text[index] == "\\" and index + 1 < len(text) else 1
        if index >= len(text):
            return None
        index += 1
        while index < len(text) and text[index] in " \t\n":
            index += 1
    if index < len(text) and text[index] == ")":
        return index + 1
    return None


def destination_end(text, index):
    while index < len(text) and text[index] in " \t\n":
        index += 1
    if index >= len(text):
        return None
    buf = []
    stopped_at_space = False
    if text[index] == "<":
        index += 1
        while index < len(text):
            escaped = take_escape(text, index, buf)
            if escaped is not None:
                index = escaped
                continue
            if text[index] == "\n":
                return "unclosed"
            if text[index] == "<":
                return "escape"
            if text[index] == ">":
                index += 1
                break
            buf.append(text[index])
            index += 1
        else:
            return "unclosed"
        if destination_close(text, index) is None:
            return "escape"
    else:
        depth = 0
        while index < len(text) and text[index] not in " \t\n":
            escaped = take_escape(text, index, buf)
            if escaped is not None:
                index = escaped
                continue
            if text[index] == "(":
                depth += 1
            elif text[index] == ")":
                if depth == 0:
                    break
                depth -= 1
            buf.append(text[index])
            index += 1
        stopped_at_space = index < len(text) and text[index] in " \t\n"
    end = destination_close(text, index)
    if end is None:
        return "spaces" if stopped_at_space else "unclosed"
    return "".join(buf), end


LINK_ERRORS = {
    "escape": "escape < and > in the destination as \\< and \\>",
    "spaces": "use angle brackets when the destination contains spaces",
    "unclosed": "link destination is not closed",
}


def parse_link(text, index):
    end = label_end(text, index + 1)
    if end is None or end >= len(text) or text[end] != "(":
        return None
    destination = destination_end(text, end + 1)
    label = link_label(text[index + 1:end - 1])
    if isinstance(destination, str):
        return {"error": LINK_ERRORS[destination], "label": label, "end": end}
    if destination is None:
        return {"error": LINK_ERRORS["unclosed"], "label": label, "end": end}
    dest, after = destination
    return {"dest": dest, "label": label, "end": after}


def markdown_links(text):
    found = []
    index = 0
    while index < len(text):
        if fence_open(text, index):
            index = skip_fence(text, index)
            continue
        if text[index] == "\\":
            index += 2 if index + 1 < len(text) else 1
            continue
        if text[index] == "`":
            index = skip_code_span(text, index)
            continue
        if text[index] == "[" and not (index > 0 and text[index - 1] == "!"):
            parsed = parse_link(text, index)
            if parsed is not None:
                found.append(parsed)
                index = max(parsed["end"], index + 1)
                continue
        index += 1
    return found


def decode_part(value):
    if re.search(r"%(?![0-9A-Fa-f]{2})", value):
        raise ValueError("invalid percent-encoding")
    return unquote(value)


def external_link(dest):
    # walk.js ignores scheme URLs. A single-letter drive prefix is a path, not a scheme.
    return bool(re.match(r"^[a-z][a-z0-9+.-]*:", dest, re.I)) and not re.match(r"^[a-z]:", dest, re.I)


def check_code_link(root, location, file, quote, errors):
    if not valid_path(file):
        errors.append(f"{location}: expected a path inside the workspace")
        return
    try:
        text = source_text(source_path(root, file))
    except (OSError, ValueError) as error:
        errors.append(f"{location}: {error}")
        return
    if quote is None:
        return
    if quote == "":
        errors.append(f"{location}: quote must not be empty")
        return
    count = quote_count(text, quote)
    if count != 1:
        errors.append(f"{location}: quote occurs {count} times in {file}")


def check_markdown_links(text, root, where, errors):
    for index, link in enumerate(markdown_links(text), 1):
        label = repr(link["label"]) if link.get("label") else str(index)
        location = f"{where}, link {label}"
        if "error" in link:
            errors.append(f"{location}: {link['error']}")
            continue
        dest = link["dest"]
        if dest.startswith("#") or external_link(dest):
            continue
        try:
            if "#" in dest:
                file, quote = dest.split("#", 1)
                file, quote = decode_part(file), decode_part(quote)
            else:
                file, quote = decode_part(dest), None
        except ValueError as error:
            errors.append(f"{location}: {error}")
            continue
        check_code_link(root, location, file, quote, errors)


def validate(walk, root):
    errors = schema_errors(walk)
    if errors:
        return errors
    for step in walk["steps"]:
        where = f"Step {step['id']!r}"
        anchors = [(where, step)]
        for index, ref in enumerate(step.get("refs", [])):
            label = repr(ref["label"]) if ref.get("label") else str(index + 1)
            anchors.append((f"{where}, ref {label}", ref))
        for location, anchor in anchors:
            if "file" not in anchor:
                continue
            try:
                text = source_text(source_path(root, anchor["file"]))
                if "quote" in anchor:
                    count = quote_count(text, anchor["quote"])
                    if count != 1:
                        errors.append(f"{location}: quote occurs {count} times in {anchor['file']}")
            except (OSError, ValueError) as error:
                errors.append(f"{location}: {error}")
        check_markdown_links(step["body"], root, where, errors)
        if "details" in step:
            check_markdown_links(step["details"], root, where, errors)
        if "diff" in step:
            try:
                check_diff(step, root)
            except (OSError, ValueError) as error:
                errors.append(f"{where}, diff: {error}")
    return errors


def reject_constant(value):
    raise ValueError(f"invalid JSON constant {value}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workspace", type=Path, help="VS Code workspace root (first folder if multi-root)")
    parser.add_argument("--walk", type=Path, help="candidate JSON path; relative paths start at the workspace root")
    args = parser.parse_args()
    root = args.workspace.expanduser().resolve()
    if not root.is_dir():
        parser.error(f"workspace directory does not exist: {root}")
    path = root / (args.walk.expanduser() if args.walk else Path(".tandem/walk.json"))
    try:
        walk = json.loads(path.read_text(encoding="utf-8"), parse_constant=reject_constant)
        errors = validate(walk, root)
    except (OSError, ValueError) as error:
        errors = [f"{path}: {error}"]
    if errors:
        print("\n".join(errors), file=sys.stderr)
        return 1
    print(f"Valid walk: {len(walk['steps'])} steps in {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
