"""Exercise candidate identity across build output and checkout relocation."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


QA = Path(__file__).resolve().parents[1] / 'contract.py'


class PortableIdentity(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.workspace = Path(temporary.name).resolve()
        self.root = self.workspace / 'before' / 'project'
        self.folder = self.root / 'docs/specs/change'
        self.folder.mkdir(parents=True)
        (self.root / 'app.py').write_text('enabled = True\n', encoding='utf-8')
        self.task = dict(id='T1', project_path=str(self.root), kind='evidence',
                         files_allowed=['app.py'], evidence_checks=[], depends_on=[])
        (self.folder / 'tasks.json').write_text(json.dumps(dict(tasks=[self.task])), encoding='utf-8')

    def candidate(self, root, *, mapping=None, success=True):
        folder = root / 'docs/specs/change'
        args = [sys.executable, '-B', str(QA), str(folder), 'candidate', '--project-root', str(root)]
        if mapping is not None:
            args += ['--root-map-json', json.dumps(mapping)]
        result = subprocess.run(args, capture_output=True, text=True)
        self.assertEqual(result.returncode == 0, success, result.stderr)
        return json.loads(result.stdout)['candidate'] if success else result.stderr

    def policy(self, *outputs):
        data = dict(contract=dict(obligations=[], candidate_policy=dict(generated_outputs=list(outputs))))
        (self.folder / 'qa.json').write_text(json.dumps(data), encoding='utf-8')

    def test_relocated_checkout_keeps_identity_only_with_explicit_root_mapping(self):
        before = self.candidate(self.root)
        copied = self.workspace / 'after' / 'project'
        shutil.copytree(self.root, copied)
        mapping = {str(self.root): str(copied)}
        after = self.candidate(copied, mapping=mapping)
        self.assertEqual(before, after)
        (copied / 'app.py').write_text('enabled = False\n', encoding='utf-8')
        self.assertNotEqual(before, self.candidate(copied, mapping=mapping))

    def test_declared_build_outputs_do_not_change_candidate_but_source_does(self):
        self.policy('bin/Debug', 'obj/Debug')
        before = self.candidate(self.root)
        for relative in ('bin/Debug/net8.0/App.dll', 'obj/Debug/net8.0/cache.bin'):
            file = self.root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(b'generated output')
        self.assertEqual(before, self.candidate(self.root))
        (self.root / 'app.py').write_text('enabled = False\n', encoding='utf-8')
        self.assertNotEqual(before, self.candidate(self.root))

    def test_candidate_cannot_hide_a_declared_source_as_build_output(self):
        self.policy('app.py')
        error = self.candidate(self.root, success=False)
        self.assertIn('source', error.lower())

    def test_undeclared_bin_files_are_still_fingerprinted(self):
        file = self.root / 'bin' / 'entry.py'
        file.parent.mkdir()
        file.write_text('value = 1\n', encoding='utf-8')
        before = self.candidate(self.root)
        file.write_text('value = 2\n', encoding='utf-8')
        self.assertNotEqual(before, self.candidate(self.root))

    def test_tracked_source_cannot_be_excluded_as_generated(self):
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True)
        file = self.root / 'bin' / 'tracked.py'
        file.parent.mkdir()
        file.write_text('value = 1\n', encoding='utf-8')
        subprocess.run(['git', '-C', str(self.root), 'add', 'bin/tracked.py'], check=True)
        self.policy('bin')
        self.assertIn('tracked', self.candidate(self.root, success=False).lower())

    def test_nested_project_inputs_remain_protected(self):
        nested = self.root / 'packages' / 'service'
        nested.mkdir(parents=True)
        task = dict(self.task, id='T2', project_path=str(nested), files_allowed=['bin/rules.py'])
        (self.folder / 'tasks.json').write_text(json.dumps(dict(tasks=[self.task, task])), encoding='utf-8')
        self.policy('packages/service/bin')
        self.assertIn('source', self.candidate(self.root, success=False).lower())

    def test_nested_project_output_does_not_change_candidate(self):
        nested = self.root / 'packages' / 'service'
        nested.mkdir(parents=True)
        task = dict(self.task, id='T2', project_path=str(nested), files_allowed=['service.py'])
        (self.folder / 'tasks.json').write_text(json.dumps(dict(tasks=[self.task, task])), encoding='utf-8')
        self.policy('packages/service/bin/Debug')
        before = self.candidate(self.root)
        generated = nested / 'bin/Debug/app.dll'
        generated.parent.mkdir(parents=True)
        generated.write_bytes(b'generated binary')
        self.assertEqual(before, self.candidate(self.root))

    def test_worktree_git_pointer_does_not_change_candidate(self):
        (self.root / '.git').write_text('gitdir: /old/location\n', encoding='utf-8')
        before = self.candidate(self.root)
        (self.root / '.git').write_text('gitdir: /new/location\n', encoding='utf-8')
        self.assertEqual(before, self.candidate(self.root))

    @unittest.skipIf(os.name == 'nt', 'POSIX permission bits are not available')
    def test_candidate_ignores_nonexecutable_permission_differences(self):
        source = self.root / 'app.py'
        source.chmod(0o644)
        before = self.candidate(self.root)
        source.chmod(0o600)
        self.assertEqual(before, self.candidate(self.root))
        source.chmod(0o700)
        self.assertNotEqual(before, self.candidate(self.root))

    def test_explicit_mapping_allows_a_nested_project_to_move_separately(self):
        nested = self.root / 'packages' / 'service'
        nested.mkdir(parents=True)
        (nested / 'service.py').write_text('ready = True\n', encoding='utf-8')
        task = dict(self.task, id='T2', project_path=str(nested), files_allowed=['service.py'])
        (self.folder / 'tasks.json').write_text(json.dumps(dict(tasks=[self.task, task])), encoding='utf-8')
        self.policy('packages/service/bin/Debug')
        before = self.candidate(self.root)
        copied = self.workspace / 'after' / 'project'
        shutil.copytree(self.root, copied)
        separate = self.workspace / 'elsewhere' / 'service'
        separate.parent.mkdir(parents=True)
        shutil.move(str(copied / 'packages/service'), separate)
        mapping = {str(self.root): str(copied), str(nested): str(separate)}
        self.assertEqual(before, self.candidate(copied, mapping=mapping))
        output = separate / 'bin/Debug/service.dll'
        output.parent.mkdir(parents=True)
        output.write_bytes(b'generated output')
        self.assertEqual(before, self.candidate(copied, mapping=mapping))
        (separate / 'service.py').write_text('ready = False\n', encoding='utf-8')
        self.assertNotEqual(before, self.candidate(copied, mapping=mapping))


if __name__ == '__main__':
    unittest.main()
