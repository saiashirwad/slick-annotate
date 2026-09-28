#!/usr/bin/env python3
"""Read-only walk authoring checks. Python 3.9+, standard library only.

Schema rules mirror src/walk-data.ts and src/validation.ts in Tandem.
Markdown links follow the click handler in media/walk.js: split on the first `#`, then decode.
"""

import argparse
import json
import re
import sys
import os
import subprocess
from functools import lru_cache
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
    if not fields(walk, {"title": str, "steps": list}, {"check": str, "compare": dict}, "Walk", errors):
        return errors
    if "check" in walk and not walk["check"]:
        errors.append("Walk.check: must not be empty")
    if "compare" in walk:
        compare = walk["compare"]
        if fields(compare, {"base": str}, {"head": str}, "Walk.compare", errors):
            for key, value in compare.items():
                if not value:
                    errors.append(f"Walk.compare.{key}: must not be empty")
    ids = set()
    for index, step in enumerate(walk["steps"]):
        where = f"Step {index + 1}"
        if not fields(
            step,
            {"id": str, "title": str, "body": str, "places": list},
            {"details": str},
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
        anchors = []
        for place_index, place in enumerate(step["places"]):
            location = f"{where}, place {place_index + 1}"
            if fields(place, {"file": str}, {"quote": str, "label": str}, location, errors):
                anchors.append((location, place))
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


@lru_cache(maxsize=None)
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


def git(root, *args):
    try:
        result = subprocess.run(
            ["git", *args], cwd=root, capture_output=True, timeout=30,
            env={**os.environ, "LC_ALL": "C", "GIT_OPTIONAL_LOCKS": "0", "GIT_LITERAL_PATHSPECS": "1"},
        )
    except (OSError, subprocess.TimeoutExpired) as error:
        raise ValueError(f"Git unavailable: {error}") from error
    if result.returncode:
        raise ValueError(f"Git {args[0]} failed: {result.stderr.decode(errors='replace').strip()}")
    return result.stdout


def comparison_sources(root, compare):
    repo = Path(git(root, "rev-parse", "--show-toplevel").decode().strip())
    def revision(ref):
        return git(repo, "rev-parse", "--verify", "--end-of-options", ref + "^{commit}").decode().strip()
    base, head = revision(compare["base"]), revision(compare.get("head", "HEAD"))
    bases = git(repo, "merge-base", "--all", base, head).decode().strip().splitlines()
    if len(bases) != 1:
        raise ValueError("Comparison needs exactly one merge-base")
    base = bases[0]
    explicit = "head" in compare
    def tree(commit):
        entries = git(repo, "ls-tree", "-rz", "--full-tree", commit).decode().split("\0")
        return {entry.split("\t", 1)[1]: entry.split(" ", 1)[0] for entry in entries if entry}
    before, after = tree(base), tree(head) if explicit else None
    changes = git(repo, "diff", "--raw", "-z", "--patch", "--no-abbrev", "--no-color", "--unified=0", "--inter-hunk-context=0", "--find-renames", "--no-ext-diff", "--no-textconv", base, *([head] if explicit else []), "--").decode(errors="replace").split("\0")
    renames = {}
    ordered = []
    index = 0
    while changes[index].startswith(":"):
        metadata, old = changes[index:index + 2]
        status = metadata.split(" ")[4]
        index += 2
        file = old
        if status.startswith(("R", "C")):
            file = changes[index]
            renames[file] = old
            index += 1
        ordered.append(file)
    patches = re.split(r"^diff --git ", "\0".join(changes[index:]).lstrip("\0"), flags=re.M)[1:]
    if len(patches) != len(ordered):
        raise ValueError("Cannot pair Git file changes with patches")
    binary = {file for file, patch in zip(ordered, patches) if re.search(r"^Binary files |^GIT binary patch", patch, re.M)}

    @lru_cache(maxsize=None)
    def committed(commit, file):
        data = git(repo, "show", f"{commit}:{file}")
        if b"\0" in data:
            raise ValueError("Binary file: comparison unavailable")
        return data.decode("utf-8-sig")

    @lru_cache(maxsize=None)
    def versions(file):
        if "\\" in file:
            raise ValueError(f"use '/' separators in {file!r}")
        path = (root / file).relative_to(repo).as_posix()
        if path in binary:
            raise ValueError("Binary file: comparison unavailable")
        old = renames.get(path, path)
        modes = [before.get(old), after.get(path) if after is not None else None]
        if any(mode and mode not in ("100644", "100755") for mode in modes):
            raise ValueError("Symlink or submodule: comparison unavailable")
        left = committed(base, old) if old in before else None
        if explicit:
            right = committed(head, path) if path in after else None
        else:
            target = root
            for part in Path(file).parts:
                target /= part
                if target.is_symlink():
                    raise ValueError("Symlink: comparison unavailable")
            right = source_text(source_path(root, file)) if target.exists() else None
            if right is not None and "\0" in right:
                raise ValueError("Binary file: comparison unavailable")
        if left is None and right is None:
            raise ValueError("File is absent from both compared versions")
        return left, right
    return versions


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
    source_text.cache_clear()
    errors = schema_errors(walk)
    if errors:
        return errors
    versions = None
    comparison_failed = False
    if "compare" in walk:
        try:
            versions = comparison_sources(root, walk["compare"])
        except (OSError, ValueError) as error:
            errors.append(f"Comparison unavailable (walk structure is valid): {error}")
            comparison_failed = True
    for step in walk["steps"]:
        where = f"Step {step['id']!r}"
        for index, anchor in enumerate(step["places"]):
            location = f"{where}, place {index + 1}"
            if comparison_failed:
                continue
            try:
                texts = versions(anchor["file"]) if versions else (source_text(source_path(root, anchor["file"])),)
                if "quote" in anchor:
                    counts = [quote_count(text, anchor["quote"]) if text is not None else 0 for text in texts]
                    if max(counts) > 1 or 1 not in counts:
                        errors.append(f"{location}: quote must be unique in at least one version and unambiguous in both; occurrences {counts} in {anchor['file']}")
            except (OSError, ValueError) as error:
                errors.append(f"{location}: {error}")
        check_markdown_links(step["body"], root, where, errors)
        if "details" in step:
            check_markdown_links(step["details"], root, where, errors)
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
