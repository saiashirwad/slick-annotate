"""Comparison regressions in disposable repositories; never changes the invoking workspace."""

from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

from validate_walk import comparison_sources, git, validate


class ComparisonTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="tandem-validator-test-")
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name).resolve()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Tandem regression")
        self.git("config", "user.email", "test@example.invalid")
        self.put("service.ts", "service anchor\nstable\n")

    def git(self, *args):
        return subprocess.check_output(["git", *args], cwd=self.root, stderr=subprocess.PIPE).decode().strip()

    def put(self, file, text):
        (self.root / file).write_text(text)

    def commit(self):
        self.git("add", ".")
        self.git("commit", "-m", "fixture")

    def walk(self, places, compare=None):
        walk = {"title": "Test", "steps": [{"id": "step", "title": "Step", "body": "", "places": places}]}
        if compare is not None:
            walk["compare"] = compare
        return walk

    def test_type_change_is_local(self):
        (self.root / "link").symlink_to("service.ts")
        self.put("regular", "regular\n")
        self.commit()
        base = self.git("rev-parse", "HEAD")
        (self.root / "link").unlink()
        self.put("link", "now regular\n")
        (self.root / "regular").unlink()
        (self.root / "regular").symlink_to("service.ts")
        self.put("service.ts", "changed service\nstable\n")
        self.commit()
        for compare in ({"base": base}, {"base": base, "head": "HEAD"}):
            self.assertEqual(validate(self.walk([{"file": "service.ts"}], compare), self.root), [])
            errors = validate(self.walk([{"file": "service.ts"}, {"file": "link"}, {"file": "regular"}], compare), self.root)
            self.assertEqual(len(errors), 2)
            self.assertTrue(all("place 2" in error or "place 3" in error for error in errors))

    def test_removed_index_entry_uses_disk(self):
        self.commit()
        self.git("rm", "--cached", "service.ts")
        index = (self.root / ".git/index").read_bytes()
        self.put("service.ts", "disk-only anchor\nstable\n")
        versions = comparison_sources(self.root, {"base": "HEAD"}, ["service.ts"])
        self.assertEqual(versions("service.ts"), ("service anchor\nstable\n", "disk-only anchor\nstable\n"))
        self.assertEqual((self.root / ".git/index").read_bytes(), index)

    def test_missing_blob_is_local(self):
        self.put("broken.ts", "old broken content\n")
        self.commit()
        base = self.git("rev-parse", "HEAD")
        blob = self.git("rev-parse", f"{base}:broken.ts")
        self.put("broken.ts", "readable replacement\n")
        self.put("service.ts", "changed service\nstable\n")
        self.commit()
        (self.root / ".git/objects" / blob[:2] / blob[2:]).unlink()
        for compare in ({"base": base}, {"base": base, "head": "HEAD"}):
            errors = validate(self.walk([{"file": "broken.ts"}, {"file": "service.ts"}], compare), self.root)
            self.assertEqual(len(errors), 1)
            self.assertIn("place 1", errors[0])

    def test_plain_symlink_and_comparison_policy(self):
        (self.root / "link.ts").symlink_to("service.ts")
        self.commit()
        places = [{"file": "link.ts", "quote": "service anchor"}]
        self.assertEqual(validate(self.walk(places), self.root), [])
        self.assertIn("Symlink", validate(self.walk(places, {"base": "HEAD"}), self.root)[0])

    def test_legacy_fields_still_rejected(self):
        for field in ("file", "quote", "refs", "proposal", "diff"):
            walk = self.walk([])
            walk["steps"][0][field] = "legacy"
            self.assertIn("unknown field", validate(walk, self.root)[0])

    def test_case_distinct_committed_paths_without_checkout(self):
        self.commit()
        def input_git(text, *args):
            return subprocess.check_output(["git", *args], cwd=self.root, input=text.encode()).decode().strip()
        def tree(upper, lower):
            a = input_git(upper, "hash-object", "-w", "--stdin")
            b = input_git(lower, "hash-object", "-w", "--stdin")
            return input_git(f"100644 blob {a}\tThing.ts\n100644 blob {b}\tthing.ts\n", "mktree")
        base = self.git("commit-tree", tree("old upper\n", "old lower\n"), "-p", "HEAD", "-m", "base")
        head = self.git("commit-tree", tree("new upper\n", "new lower\n"), "-p", base, "-m", "head")
        for names in (("Thing.ts", "thing.ts"), ("thing.ts", "Thing.ts")):
            versions = comparison_sources(self.root, {"base": base, "head": head}, names)
            self.assertEqual(versions("Thing.ts"), ("old upper\n", "new upper\n"))
            self.assertEqual(versions("thing.ts"), ("old lower\n", "new lower\n"))
        self.assertEqual(self.git("status", "--porcelain"), "")

    def test_tree_reads_are_path_scoped_and_empty_places_skip_git(self):
        self.commit()
        with patch("validate_walk.git", wraps=git) as calls:
            self.assertEqual(validate(self.walk([{"file": "service.ts"}], {"base": "HEAD"}), self.root), [])
            trees = [call.args for call in calls.call_args_list if call.args[1] == "ls-tree"]
            self.assertEqual(len(trees), 1)
            self.assertEqual(trees[0][-2:], ("--", "service.ts"))
            calls.reset_mock()
            self.assertEqual(validate(self.walk([], {"base": "missing"}), self.root), [])
            calls.assert_not_called()


if __name__ == "__main__":
    unittest.main()
