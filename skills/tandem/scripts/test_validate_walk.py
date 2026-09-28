"""Comparison regressions in disposable repositories; never changes the invoking workspace."""

from pathlib import Path
import subprocess
import tempfile
import unittest

from validate_walk import comparison_sources, parse_changes, validate


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
        raw = self.git("-c", "core.quotePath=false", "diff", "--raw", "-z", "--patch", "--unified=0", base, "HEAD", "--")
        self.assertIsNone(parse_changes(raw.encode())["service.ts"]["reason"])
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

    def test_unstaged_edited_rename_accepts_old_quote(self):
        original = "old anchor\none\ntwo\nthree\nfour\nfive\nsix\n"
        self.put("old.ts", original)
        self.commit()
        (self.root / "old.ts").rename(self.root / "new.ts")
        for changed in (False, True):
            if changed:
                self.put("new.ts", original.replace("old anchor", "new anchor"))
            index = (self.root / ".git/index").read_bytes()
            status = self.git("status", "--porcelain")
            walk = self.walk([{"file": "new.ts", "quote": "old anchor"}], {"base": "HEAD"})
            self.assertEqual(validate(walk, self.root), [])
            self.assertEqual((self.root / ".git/index").read_bytes(), index)
            self.assertEqual(self.git("status", "--porcelain"), status)

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


if __name__ == "__main__":
    unittest.main()
