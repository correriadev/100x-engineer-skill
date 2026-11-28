"""Verify QA evidence selection and findings through the published contracts."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


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


if __name__ == "__main__":
    unittest.main()
