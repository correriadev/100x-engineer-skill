"""Verify QA evidence selection and findings through the published contracts."""
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import zipfile


SKILLS = Path(__file__).resolve().parents[2]
QA = SKILLS / "qa-scope/contract.py"
EXECUTOR = SKILLS / "execute-scope/contract.py"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def canonical_hash(value):
    return sha(json.dumps(value, sort_keys=True, ensure_ascii=True, separators=(",", ":")).encode())


class CandidateEvidence(unittest.TestCase):
    def setUp(self):
        temp = tempfile.TemporaryDirectory()
        self.addCleanup(temp.cleanup)
        self.root = Path(temp.name).resolve()
        self.folder = self.root / "docs/specs/check-candidate"
        self.folder.mkdir(parents=True)
        scope = b"# Evidence scope\n\nA1 Cancel the dispatch.\nR1 Dispatch despite cancellation.\n"
        (self.folder / "SCOPE.md").write_bytes(scope)
        self.scope = sha(scope)
        primary = dict(id="QA-1", status="ready", pending_reason=None, blocking=True,
                       acceptance_ids=["A1"], risk_ids=["R1"], failure_to_detect="Unexpected dispatch.",
                       preconditions=["Use isolated records."], stimulus="Cancel the dispatch.",
                       observables=["Dispatch count"], assertions=["Expect zero."], environment="Fixture",
                       artifacts=["Recorded result"], source_refs=["tests/check.py:1"])
        advisory = dict(primary, id="QA-2", status="pending", blocking=False,
                        pending_reason="Confirm the advisory observation.")
        self.contract = dict(change_id=self.folder.name, scope_revision=self.scope,
                             risk_coverage=[dict(risk_id="R1", obligation_ids=["QA-1", "QA-2"])],
                             obligations=[primary, advisory])
        self.revision = canonical_hash(self.contract)
        self.write(QA, "qa-plan", self.contract, "qa.json")
        self.checks = [
            dict(id=f"check-{i}", command="python -m unittest", qa_ids=[f"QA-{i}"], files=["tests/check.py"])
            for i in (1, 2)
        ]
        self.task = dict(id="T1", project_path=str(self.root), kind="evidence", files_allowed=[],
                         evidence_checks=self.checks, depends_on=[], status="pending", phase="evidence_pending")
        self.plan = dict(change_id=self.folder.name, scope_revision=self.scope, qa_revision=self.revision,
                         tasks=[self.task], evidence=[])
        self.write(EXECUTOR, "plan", self.plan, "tasks.json")
        self.task["status"] = "in_progress"
        self.write(EXECUTOR, "build", self.plan, "tasks.json")

    def cli(self, script, *args, payload=None, status=0):
        result = subprocess.run(
            [sys.executable, "-B", str(script), str(self.folder), *args],
            input=json.dumps(payload) if payload is not None else None,
            capture_output=True, text=True,
        )
        self.assertEqual(result.returncode, status, result.stderr)
        return json.loads(result.stdout) if result.stdout else result.stderr

    def write(self, script, operation, body, filename, *, status=0):
        dest = self.folder / filename
        snapshot = sha(dest.read_bytes()) if dest.exists() else "absent"
        return self.cli(script, operation, "--expect", snapshot, payload=body, status=status)

    def start(self, key, candidate, *, check=0):
        definition = dict(cwd=str(self.root), check=self.checks[check])
        self.plan["evidence"].append(dict(
            id=f"start-{key}", event="started", task_id="T1", check_id=self.checks[check]["id"],
            definition=definition, definition_digest=canonical_hash(definition),
            qa_revision=self.revision, candidate=candidate, environment="Fixture",
        ))
        self.write(EXECUTOR, "build", self.plan, "tasks.json")

    def record(self, key, values, *, candidate="fixture", check=0, exit_code=0, artifact_ref=None):
        self.start(key, candidate, check=check)
        self.plan["evidence"].append(dict(
            id=key, event="result", attempt_id=f"start-{key}", status="observed", exit_code=exit_code,
            candidate_after=candidate, environment_after="Fixture", artifact_ref=artifact_ref or f"{key}.json",
            test_refs=["test_no_dispatch"], assertions=["Expect zero."], observed_values=values,
        ))
        self.write(EXECUTOR, "build", self.plan, "tasks.json")

    def assess(self, verdict, refs, *, advisory=None, status=0, candidate="fixture"):
        findings = [
            dict(id="QA-1", status=verdict, rationale="Fixture verification.", evidence_ids=refs),
            dict(id="QA-2", status="PASS" if advisory else "INCONCLUSIVE", rationale="Advisory observation.",
                 evidence_ids=[advisory] if advisory else []),
        ]
        payload = dict(id=f"assessment-{verdict}", candidate=candidate, scope_revision=self.scope,
                       qa_revision=self.revision, status=verdict, findings=findings)
        return self.write(QA, "qa-check", payload, "qa.json", status=status)

    def export_fixture(self, artifact_ref='.100x/evidence/result.json'):
        (self.root / 'app.py').write_text('value = 1\n', encoding='utf-8')
        artifact = self.root / artifact_ref
        if artifact_ref != 'app.py':
            artifact.parent.mkdir(parents=True)
            artifact.write_text('{"dispatch_count": 0}', encoding='utf-8')
        candidate = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
        self.record('current', {'dispatch_count': 0}, candidate=candidate, artifact_ref=artifact_ref)
        self.task['status'], self.task['phase'] = 'completed', 'completed'
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        self.assess('PASS', ['current'], candidate=candidate)
        destination = tempfile.TemporaryDirectory()
        self.addCleanup(destination.cleanup)
        bundle = Path(destination.name) / 'evidence.zip'
        self.cli(QA, 'export-evidence', '--project-root', str(self.root), '--bundle', str(bundle))
        moved = Path(destination.name) / 'checkout'
        shutil.copytree(self.root, moved, ignore=shutil.ignore_patterns('.100x'))
        return bundle, moved, candidate

    def relocated_cli(self, moved, *args):
        folder = moved / 'docs/specs/check-candidate'
        return subprocess.run([sys.executable, '-B', str(QA), str(folder), *args],
                              capture_output=True, text=True)

    def test_empty_values_are_inconclusive_and_explicit_zero_can_support_pass(self):
        self.record("empty", {})
        for verdict in ("PASS", "FAIL"):
            result = self.assess(verdict, ["empty"], status=1)
            self.assertIn("requires recorded observed values", result)
        self.assess("INCONCLUSIVE", ["empty"])
        self.record("zero", {"dispatch_count": 0, "sent": False, "matched_rows": []})
        self.assess("PASS", ["zero"])
        saved = json.loads((self.folder / "qa.json").read_text())
        self.assertEqual([a["status"] for a in saved["assessments"]], ["INCONCLUSIVE", "PASS"])

    def test_pending_advisory_obligation_requires_inconclusive_finding(self):
        self.record("primary", {"dispatch_count": 0})
        self.record("advisory", {"dispatch_count": 0}, check=1)
        self.assertIn("Pending obligation", self.assess("PASS", ["primary"], advisory="advisory", status=1))
        self.assess("PASS", ["primary"])

    def test_recorded_empty_query_result_can_support_pass(self):
        self.record("no-rows", [])
        self.assess("PASS", ["no-rows"])

    def test_projection_uses_the_candidate_and_obligation_and_does_not_write(self):
        self.record("valid", {"dispatch_count": 0})
        self.record("empty", {})
        self.record("other-candidate", {"dispatch_count": 1}, candidate="other")
        self.record("other-obligation", {"dispatch_count": 0}, check=1)
        self.record("failed", {"dispatch_count": 2}, exit_code=1)
        self.start("unfinished", "fixture")
        (self.folder / ".contracts.guard").unlink()
        before = {path.name: path.read_bytes() for path in self.folder.iterdir()}
        found = self.cli(QA, "qa-evidence", "fixture", "--obligation", "QA-1", "--limit", "1")
        self.assertEqual(found["obligation"]["id"], "QA-1")
        self.assertEqual(found["qa_revision"], self.revision)
        self.assertEqual(found["counts"], dict(observed_results=2, excluded_results=1, unfinished_attempts=1))
        self.assertEqual(found["observed_results"][0]["result"]["id"], "failed")
        self.assertEqual(found["observed_results"][0]["start"]["id"], "start-failed")
        self.assertEqual(found["unfinished_attempts"][0]["id"], "start-unfinished")
        self.assertEqual(found["excluded_results"][0]["id"], "empty")
        self.assertEqual({path.name: path.read_bytes() for path in self.folder.iterdir()}, before)
        (self.folder / "SCOPE.md").write_bytes(before["SCOPE.md"] + b"\nChanged contract scope.\n")
        stale = self.cli(QA, "qa-evidence", "fixture", "--obligation", "QA-1", status=1)
        self.assertIn("stale", stale)

    def test_summary_tracks_the_current_candidate_and_contract(self):
        source = self.root / 'app.py'
        source.write_text('value = 1\n', encoding='utf-8')
        artifact = self.root / '.100x/evidence/result.json'
        artifact.parent.mkdir(parents=True)
        artifact.write_text('{"dispatch_count": 0}', encoding='utf-8')
        candidate = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
        self.record('current', {'dispatch_count': 0}, candidate=candidate, artifact_ref='.100x/evidence/result.json')
        self.task['status'] = 'completed'
        self.task['phase'] = 'completed'
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        self.assess('PASS', ['current'], candidate=candidate)
        def summary():
            return self.cli(QA, 'summary', '--project-root', str(self.root),
                            '--environment-json', json.dumps({'T1/check-1': 'Fixture'}))
        summary_result = summary()
        self.assertEqual(summary_result['status'], 'PASS')
        self.assertEqual(summary_result['candidate'], candidate)
        self.assertEqual(self.cli(QA, 'summary', '--project-root', str(self.root))['status'], 'INCONCLUSIVE')
        tasks_path = self.folder / 'tasks.json'
        original_tasks = tasks_path.read_bytes()
        altered = json.loads(original_tasks)
        altered['tasks'][0]['files_allowed'] = ['tests/changed.py']
        tasks_path.write_text(json.dumps(altered), encoding='utf-8')
        self.assertEqual(summary()['status'], 'INCONCLUSIVE')
        tasks_path.write_bytes(original_tasks)
        artifact.write_text('{"dispatch_count": 1}', encoding='utf-8')
        changed_artifact = summary()
        self.assertEqual(changed_artifact['status'], 'INCONCLUSIVE')
        artifact.unlink()
        self.assertEqual(summary()['status'], 'INCONCLUSIVE')
        artifact.write_text('{"dispatch_count": 0}', encoding='utf-8')
        self.assertEqual(summary()['status'], 'PASS')
        self.start('interrupted', candidate)
        interrupted = summary()
        self.assertEqual(interrupted['status'], 'INCONCLUSIVE')
        self.assertEqual(interrupted['unfinished_attempts'], ['start-interrupted'])
        source.write_text('value = 2\n', encoding='utf-8')
        changed = summary()
        self.assertEqual(changed['status'], 'INCONCLUSIVE')
        self.assertNotEqual(changed['candidate'], candidate)
        (self.folder / 'SCOPE.md').write_text('Changed contract scope.\n', encoding='utf-8')
        self.assertIn('stale', self.cli(QA, 'summary', '--project-root', str(self.root), status=1).lower())

    def test_source_directories_named_build_dist_and_coverage_are_fingerprinted(self):
        for relative in ('src/build/rules.py', 'src/dist/logic.py', 'tests/coverage/test_rules.py'):
            file = self.root / relative
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_text('approved = True\n', encoding='utf-8')
            before = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
            file.write_text('approved = False\n', encoding='utf-8')
            after = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
            self.assertNotEqual(before, after, relative)

    def test_declared_source_under_dependency_directory_is_fingerprinted(self):
        file = self.root / 'node_modules/company/rules.js'
        file.parent.mkdir(parents=True)
        file.write_text('export const allow = true;\n', encoding='utf-8')
        qa_path = self.folder / 'qa.json'
        document = json.loads(qa_path.read_text(encoding='utf-8'))
        document['contract']['obligations'][0]['source_refs'] = ['node_modules/company/rules.js:1']
        qa_path.write_text(json.dumps(document), encoding='utf-8')
        before = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
        file.write_text('export const allow = false;\n', encoding='utf-8')
        after = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
        self.assertNotEqual(before, after)

    def test_exported_evidence_survives_relocation_without_the_original_checkout(self):
        bundle, moved, candidate = self.export_fixture()
        old_root = str(self.root)
        shutil.rmtree(self.root)
        folder = moved / 'docs/specs/check-candidate'
        def invoke(*args): return self.relocated_cli(moved, *args)
        imported = invoke('import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertEqual(imported.returncode, 0, imported.stderr)
        self.assertEqual((moved / '.100x/evidence/result.json').read_text(), '{"dispatch_count": 0}')
        summary = invoke('summary', '--project-root', str(moved),
                         '--environment-json', json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(summary.returncode, 0, summary.stderr)
        restored = json.loads(summary.stdout)
        self.assertEqual(restored['status'], 'PASS')
        self.assertEqual(restored['candidate'], candidate)
        self.assertFalse(Path(old_root).exists())
        preflight = subprocess.run([sys.executable, '-B', str(EXECUTOR), str(folder), 'preflight', 'T1'],
                                   capture_output=True, text=True)
        self.assertEqual(preflight.returncode, 0, preflight.stderr)
        self.assertEqual(json.loads(preflight.stdout)['effective_project_path'], str(moved))
        no_environment = invoke('summary', '--project-root', str(moved))
        self.assertEqual(json.loads(no_environment.stdout)['status'], 'INCONCLUSIVE')
        (moved / '.100x/evidence/result.json').write_text('{"dispatch_count": 1}', encoding='utf-8')
        changed = invoke('summary', '--project-root', str(moved),
                         '--environment-json', json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(json.loads(changed.stdout)['status'], 'INCONCLUSIVE')

    def test_import_preserves_existing_conflicting_files(self):
        bundle, moved, _ = self.export_fixture()
        existing = moved / '.100x/evidence/result.json'
        existing.parent.mkdir(parents=True)
        existing.write_text('owner data', encoding='utf-8')
        result = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('overwrite', result.stderr.lower())
        self.assertEqual(existing.read_text(), 'owner data')
        self.assertFalse((moved / '.100x/evidence-root-maps/check-candidate.json').exists())

    def test_import_rejects_changed_source_and_removes_new_evidence(self):
        bundle, moved, _ = self.export_fixture()
        (moved / 'app.py').write_text('value = 2\n', encoding='utf-8')
        result = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('do not match', result.stderr.lower())
        self.assertEqual((moved / 'app.py').read_text(), 'value = 2\n')
        self.assertFalse((moved / '.100x/evidence/result.json').exists())
        self.assertFalse((moved / '.100x/evidence-root-maps/check-candidate.json').exists())

    def test_import_rejects_a_tampered_object(self):
        bundle, moved, _ = self.export_fixture()
        with zipfile.ZipFile(bundle) as source:
            members = {name: source.read(name) for name in source.namelist()}
        object_name = next(name for name in members if name.startswith('objects/'))
        members[object_name] += b'tampered'
        altered = bundle.with_name('altered.zip')
        with zipfile.ZipFile(altered, 'w') as output:
            for name, data in members.items():
                output.writestr(name, data)
        result = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(altered))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('digest mismatch', result.stderr.lower())
        self.assertFalse((moved / '.100x/evidence-root-maps/check-candidate.json').exists())

    def test_import_does_not_follow_an_evidence_directory_symlink(self):
        bundle, moved, _ = self.export_fixture()
        outside = moved.parent / 'outside'
        outside.mkdir()
        (moved / '.100x').mkdir()
        try:
            (moved / '.100x/evidence').symlink_to(outside, target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('The platform cannot create symlinks')
        result = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('symlink', result.stderr.lower())
        self.assertEqual(list(outside.iterdir()), [])

    def test_export_refuses_an_artifact_changed_after_assessment(self):
        bundle, _, _ = self.export_fixture()
        (self.root / '.100x/evidence/result.json').write_text('altered', encoding='utf-8')
        result = self.cli(QA, 'export-evidence', '--project-root', str(self.root),
                          '--bundle', str(bundle.with_name('must-not-exist.zip')), status=1)
        self.assertIn('missing or changed', result.lower())
        self.assertFalse(bundle.with_name('must-not-exist.zip').exists())

    def test_nonstandard_artifact_is_restored_as_a_safe_snapshot(self):
        bundle, moved, candidate = self.export_fixture(artifact_ref='app.py')
        result = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertEqual(result.returncode, 0, result.stderr)
        summary = self.relocated_cli(moved, 'summary', '--project-root', str(moved),
                                     '--environment-json', json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(summary.returncode, 0, summary.stderr)
        value = json.loads(summary.stdout)
        self.assertEqual(value['status'], 'PASS')
        self.assertEqual(value['candidate'], candidate)
        snapshot = Path(value['evidence'][0]['local_snapshot'])
        self.assertEqual(snapshot.read_text(), 'value = 1\n')
        snapshot.write_text('altered', encoding='utf-8')
        changed = self.relocated_cli(moved, 'summary', '--project-root', str(moved),
                                    '--environment-json', json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(json.loads(changed.stdout)['status'], 'INCONCLUSIVE')

    def test_changed_runtime_binary_invalidates_evidence_even_when_build_output_is_excluded(self):
        self.contract['candidate_policy'] = dict(generated_outputs=['bin/Debug'])
        self.write(QA, 'qa-plan', self.contract, 'qa.json')
        self.revision = canonical_hash(self.contract)
        self.plan['qa_revision'] = self.revision
        self.checks[0]['runtime_artifacts'] = ['bin/Debug/App.dll']
        self.task['status'], self.task['phase'] = 'pending', 'evidence_pending'
        self.write(EXECUTOR, 'plan', self.plan, 'tasks.json')
        self.task['status'] = 'in_progress'
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        binary = self.root / 'bin/Debug/App.dll'
        binary.parent.mkdir(parents=True)
        binary.write_bytes(b'compiled version one')
        binary.chmod(0o755)
        artifact = self.root / '.100x/evidence/result.json'
        artifact.parent.mkdir(parents=True)
        artifact.write_text('{"dispatch_count": 0}', encoding='utf-8')
        candidate = self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate']
        products = self.cli(QA, 'runtime-artifacts', '--project-root', str(self.root),
                            '--task-id', 'T1', '--check-id', 'check-1')['artifacts']
        definition = dict(cwd=str(self.root), check=self.checks[0])
        self.plan['evidence'].append(dict(id='missing-binary', event='started', task_id='T1', check_id='check-1',
                                          definition=definition, definition_digest=canonical_hash(definition),
                                          qa_revision=self.revision, candidate=candidate, environment='Fixture'))
        error = self.write(EXECUTOR, 'build', self.plan, 'tasks.json', status=1)
        self.assertIn('bind every planned runtime artifact', error)
        self.plan['evidence'].pop()
        self.plan['evidence'].append(dict(id='start-binary', event='started', task_id='T1', check_id='check-1',
                                          definition=definition, definition_digest=canonical_hash(definition),
                                          qa_revision=self.revision, candidate=candidate, environment='Fixture',
                                          runtime_artifacts=products))
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        self.plan['evidence'].append(dict(id='binary', event='result', attempt_id='start-binary', status='observed',
                                          candidate_after=candidate, environment_after='Fixture', exit_code=0,
                                          artifact_ref='.100x/evidence/result.json', test_refs=['test_no_dispatch'],
                                          assertions=['Expect zero.'], observed_values={'dispatch_count': 0},
                                          runtime_artifacts_after=products))
        self.plan['evidence'][-1]['runtime_artifacts_after'] = {'bin/Debug/App.dll': 'sha256:' + '0' * 64}
        error = self.write(EXECUTOR, 'build', self.plan, 'tasks.json', status=1)
        self.assertIn('stable identity', error)
        self.plan['evidence'][-1]['runtime_artifacts_after'] = products
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        self.task['status'], self.task['phase'] = 'completed', 'completed'
        self.write(EXECUTOR, 'build', self.plan, 'tasks.json')
        self.assess('PASS', ['binary'], candidate=candidate)
        args = ('summary', '--project-root', str(self.root), '--environment-json',
                json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(self.cli(QA, *args)['status'], 'PASS')
        destination = tempfile.TemporaryDirectory()
        self.addCleanup(destination.cleanup)
        bundle = Path(destination.name) / 'runtime.zip'
        self.cli(QA, 'export-evidence', '--project-root', str(self.root), '--bundle', str(bundle))
        moved = Path(destination.name) / 'checkout'
        shutil.copytree(self.root, moved, ignore=shutil.ignore_patterns('.100x', 'bin'))
        imported = self.relocated_cli(moved, 'import-evidence', '--project-root', str(moved), '--bundle', str(bundle))
        self.assertEqual(imported.returncode, 0, imported.stderr)
        self.assertEqual((moved / 'bin/Debug/App.dll').read_bytes(), b'compiled version one')
        if sys.platform != 'win32':
            self.assertTrue((moved / 'bin/Debug/App.dll').stat().st_mode & 0o111)
        relocated = self.relocated_cli(moved, 'summary', '--project-root', str(moved), '--environment-json',
                                       json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(json.loads(relocated.stdout)['status'], 'PASS')
        (moved / 'bin/Debug/App.dll').write_bytes(b'compiled version two')
        relocated = self.relocated_cli(moved, 'summary', '--project-root', str(moved), '--environment-json',
                                       json.dumps({'T1/check-1': 'Fixture'}))
        self.assertEqual(json.loads(relocated.stdout)['status'], 'INCONCLUSIVE')
        binary.write_bytes(b'compiled version two')
        self.assertEqual(self.cli(QA, 'candidate', '--project-root', str(self.root))['candidate'], candidate)
        changed = self.cli(QA, *args)
        self.assertEqual(changed['status'], 'INCONCLUSIVE')
        self.assertTrue(changed['runtime_artifact_issues'])


if __name__ == "__main__":
    unittest.main()
