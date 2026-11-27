#!/usr/bin/env python3
"""Inspect and update one change's contracts using optimistic concurrency."""
import argparse
from contextlib import contextmanager
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import re
import sqlite3


def digest(data):
    return hashlib.sha256(data).hexdigest()


def contract_digest(contract):
    return digest(json.dumps(contract, sort_keys=True, ensure_ascii=True,
                             separators=(",", ":"), allow_nan=False).encode())


def read(path):
    if not path.exists():
        return None, None
    data = path.read_bytes()
    value = json.loads(data)
    if not isinstance(value, dict):
        raise ValueError(f"{path.name} must be a JSON object")
    return value, digest(data)


@contextmanager
def lock(folder):
    # Keep the lock file in place so all processes lock the same inode.
    with (folder / ".contracts.guard").open("a+b") as stream:
        if os.name == "nt":
            import msvcrt
            if stream.tell() == 0:
                stream.write(b"\0")
                stream.flush()
            stream.seek(0)
            msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream, fcntl.LOCK_EX)
        yield


def save(path, value):
    data = json.dumps(value, indent=2, ensure_ascii=False, allow_nan=False) + "\n"
    atomic_write(path, data.encode())


def atomic_write(path, data):
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temp = Path(stream.name)
        try:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
            stream.close()
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)


def indexed(items):
    result = {item["id"]: item for item in items}
    if len(result) != len(items):
        raise ValueError("Duplicate IDs")
    return result


def nonempty_text(value):
    return isinstance(value, str) and bool(value.strip())


def validate_blueprint(folder, document):
    source = folder / 'context.sqlite'
    binding = document.get('blueprint_source')
    if not binding:
        if source.exists():
            raise ValueError('New Scope specification exists; reconcile the task plan with its current revision')
        return  # Legacy plans without a New Scope database remain supported.
    if (not isinstance(binding, dict) or set(binding) != {'revision', 'sha256'}
            or type(binding['revision']) is not int or not isinstance(binding['sha256'], str)
            or source.is_symlink() or not source.is_file()
            or any((folder / ('context.sqlite' + suffix)).exists() for suffix in ('-wal', '-journal'))):
        raise ValueError('New Scope source is unavailable, active, or invalid')
    with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as db:
        db.execute('PRAGMA trusted_schema=OFF')
        db.execute('BEGIN')
        row = db.execute('SELECT change_id, revision FROM spec_meta').fetchone()
        if (not row or row != (document['change_id'], binding['revision'])
                or digest(source.read_bytes()) != binding['sha256']):
            raise ValueError('New Scope specification changed; reconcile the task plan')
        nodes = {key: (content, json.loads(details)) for key, content, details in db.execute(
            "SELECT id,content,details FROM nodes WHERE kind='task' "
            "AND state NOT IN ('superseded','resolved') "
            "AND id NOT IN (SELECT dst FROM edges WHERE relation='supersedes')")}
        planned = indexed(document['tasks'])
        blocked = indexed(document.get('blocked_tasks', []))
        if planned.keys() & blocked.keys() or planned.keys() | blocked.keys() != nodes.keys():
            raise ValueError('New Scope tasks and blockers must match the specification')
        for key, task in planned.items():
            details = db.execute('SELECT project_root,kind,unit_command,red,green FROM task_details WHERE task_id=?',
                                 (key,)).fetchone()
            if not details:
                raise ValueError('New Scope task is missing its operational mapping')
            root, kind, command, red, green = details
            files = list(db.execute('SELECT path,origin,role FROM task_files WHERE task_id=? ORDER BY path', (key,)))
            content, extra = nodes[key]
            checks = extra.get('evidence_checks', [])
            qa_ids = list(dict.fromkeys([*extra.get('qa_ids', []),
                                         *(qa for check in checks for qa in check['qa_ids'])]))
            dependencies = [dict(task=entry[0]) for entry in db.execute(
                "SELECT dst FROM edges WHERE src=? AND relation='depends_on' ORDER BY dst", (key,))]
            acceptance = [entry[0] for entry in db.execute(
                "SELECT e.dst FROM edges e JOIN nodes n ON n.id=e.dst WHERE e.src=? AND e.relation='implements' "
                "AND n.kind='acceptance' AND n.state NOT IN ('superseded','resolved') "
                "AND n.id NOT IN (SELECT dst FROM edges WHERE relation='supersedes') ORDER BY e.dst", (key,))]
            expected = dict(id=key, kind=kind, project_path=root, description=content, technical_steps=[content],
                            acceptance_ids=acceptance, files_allowed=[p for p, _, _ in files],
                            planned_files=[p for p, origin, _ in files if origin == 'new'], depends_on=dependencies,
                            qa_ids=qa_ids, evidence_checks=checks)
            if kind == 'implementation':
                expected.update(unit_tests=dict(files=[p for p, _, role in files if role == 'unit'], command=command),
                                red=red, green=green)
            if extra.get('smoke_command'):
                expected['smoke_command'] = extra['smoke_command']
            actual = {k: v for k, v in task.items() if k not in ('status', 'phase', 'attempts', 'error')}
            if actual != expected:
                raise ValueError('New Scope task definition differs from its specification: ' + key)


def text_list(value):
    return isinstance(value, list) and bool(value) and all(map(nonempty_text, value))


def scoped_acceptance_ids(folder, scope_text):
    source = folder / 'context.sqlite'
    if source.exists() or source.is_symlink():
        if (source.is_symlink() or not source.is_file()
                or any((folder / ('context.sqlite' + suffix)).exists() for suffix in ('-wal', '-journal'))):
            raise ValueError('Specification source is unavailable, active, or invalid')
        with sqlite3.connect(source.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.execute('PRAGMA trusted_schema=OFF')
            db.execute('BEGIN')
            meta = db.execute('SELECT change_id, revision FROM spec_meta').fetchone()
            match = re.search(r'(?m)^Database revision: ([0-9]+)$', scope_text)
            if not meta or meta[0] != folder.name or not match or meta[1] != int(match.group(1)):
                raise ValueError('New Scope specification and scope revisions differ; render the current scope')
            active = {row[0] for row in db.execute(
                "SELECT id FROM nodes WHERE kind='acceptance' AND state <> 'superseded' "
                "AND id NOT IN (SELECT dst FROM edges WHERE relation='supersedes')")}
            section = re.search(r'(?ms)^## Acceptance criteria[ \t]*\r?\n(.*?)(?=^## |\Z)', scope_text)
            rendered = set(re.findall(r'(?m)^- \*\*([A-Za-z][A-Za-z0-9_.:-]*) — ', section.group(1))) if section else set()
            if not section or rendered != active:
                raise ValueError('New Scope acceptance criteria do not match the rendered scope')
            return active
    # Standalone scopes declare each acceptance ID at the beginning of a line or table row.
    return set(re.findall(r'(?m)^[|*# \-]*\*{0,2}(A[A-Za-z0-9_-]*)(?=\*|\s|[:|—])', scope_text))


def validate_qa(contract, scope_text, folder, *, publishing=False):
    obligations = indexed(contract["obligations"])
    risks = set(re.findall(r"(?m)^[|*# \-]*\*{0,2}(R[0-9]+)\b", scope_text))
    acceptances = scoped_acceptance_ids(folder, scope_text)
    coverage = {}
    for entry in contract.get("risk_coverage", []):
        key, refs = entry["risk_id"], set(entry["obligation_ids"])
        if key in coverage or not refs or any(
            ref not in obligations or key not in obligations[ref]["risk_ids"] for ref in refs
        ):
            raise ValueError("Invalid risk coverage")
        coverage[key] = refs
    if risks != coverage.keys():
        raise ValueError("QA coverage must match scoped risks")
    if not obligations and not contract.get("empty_obligations_rationale"):
        raise ValueError("Empty QA contract requires an explicit scope decision")
    for obligation in obligations.values():
        if not text_list(obligation.get("acceptance_ids")) or set(obligation["acceptance_ids"]) - acceptances:
            raise ValueError("QA obligation references an unknown or inactive acceptance criterion")
        if publishing:
            for field in ("acceptance_ids", "risk_ids", "preconditions", "observables",
                          "assertions", "artifacts", "source_refs"):
                if not text_list(obligation.get(field)):
                    raise ValueError(f"Invalid or missing QA field: {field}")
            for field in ("failure_to_detect", "stimulus", "environment"):
                if not nonempty_text(obligation.get(field)):
                    raise ValueError(f"Invalid or missing QA field: {field}")
            if (obligation["status"] == "pending" and not nonempty_text(obligation.get("pending_reason"))
                or obligation["status"] == "ready" and obligation["pending_reason"] is not None):
                raise ValueError("Invalid QA pending reason")
        if type(obligation["blocking"]) is not bool or obligation["status"] not in ("ready", "pending"):
            raise ValueError("Invalid obligation status")
        for risk in obligation["risk_ids"]:
            if obligation["id"] not in coverage.get(risk, set()):
                raise ValueError("Obligation missing from risk coverage")
    return obligations


def task_state(task):
    return task["status"], task["phase"]


STATE_FIELDS = {"status", "phase", "attempts", "error"}


def task_definition(task):
    return {key: value for key, value in task.items() if key not in STATE_FIELDS}


def validate_replan(planned, previous, phases, scope_changed, qa_changed):
    invalidated = set()
    for key, task in planned.items():
        prior = previous.get(key)
        if (not prior or task_definition(task) != task_definition(prior)
            or scope_changed or qa_changed and task.get("evidence_checks")
            or task_state(prior)[0] != "pending" and task_state(task)[0] == "pending"):
            invalidated.add(key)
    while True:
        dependents = {
            key for key, task in planned.items()
            if any(dep["task"] in invalidated for dep in task["depends_on"])
        }
        if dependents <= invalidated:
            break
        invalidated.update(dependents)
    for key, task in planned.items():
        initial = ("pending", phases[key])
        if task_state(task) != initial and (
            key in invalidated or task_state(task) != task_state(previous[key])
        ):
            raise ValueError(f"Replanned task {key} must restart at {initial}")


def validate_tasks(tasks):
    phases = {}
    for key, task in tasks.items():
        check_ids = [check["id"] for check in task.get("evidence_checks", []) if "id" in check]
        if any(not nonempty_text(check_id) for check_id in check_ids) or len(set(check_ids)) != len(check_ids):
            raise ValueError("Duplicate or empty check ID within task")
        kind = task.get("kind", "implementation")
        if kind == "implementation":
            test = task["unit_tests"]
            if not test["files"] or not test["command"].strip():
                raise ValueError("Implementation requires a focused test mapping")
            if not set(test["files"]) <= set(task["files_allowed"]):
                raise ValueError("Unit tests must use authorized paths")
            phases[key] = "red_pending"
        elif kind == "evidence" and task.get("evidence_checks"):
            phases[key] = "evidence_pending"
        else:
            raise ValueError("Invalid task kind or missing evidence checks")
    remaining = {key: {dep["task"] for dep in task["depends_on"]} for key, task in tasks.items()}
    while remaining:
        ready = {key for key, deps in remaining.items() if not deps}
        if not ready:
            raise ValueError("Cyclic or unknown task dependency")
        remaining = {key: deps - ready for key, deps in remaining.items() if key not in ready}
    return phases


def validate_transition(before, after, first):
    old, new = task_state(before), task_state(after)
    if old == new:
        return
    final = "green_pending" if first == "red_pending" else first
    status, phase = old
    if status == "pending" and phase in (first, final):
        allowed = {("in_progress", phase)}
    elif status == "in_progress" and phase in (first, final):
        allowed = {("pending", phase), ("failed", phase), ("failed", "failed")}
        allowed.add(("completed", "completed") if phase == final else ("in_progress", final))
    else:
        allowed = set()
    if new not in allowed:
        raise ValueError(f"Invalid task transition {old} -> {new}")


def validate_legacy_evidence(record, tasks, revision, obligations):
    required = ("command", "test_refs", "assertions", "environment")
    if any(not record.get(key) for key in required) or record.get("observed_values") is None or type(record.get("exit_code")) is not int:
        raise ValueError("Incomplete execution evidence")
    task = tasks[record["task_id"]]
    links = set(record["qa_ids"])
    executed = task["status"] == "completed" or (
        task["status"] == "failed" and record["exit_code"] != 0
    )
    if (record["qa_revision"] != revision or not record["candidate"] or not links
        or links - obligations.keys() or not executed
        or not any(check["command"] == record["command"] and links <= set(check["qa_ids"])
                   for check in task.get("evidence_checks", []))):
        raise ValueError("Evidence does not match a executed planned check")



def validate_start(record, tasks, revision, obligations):
    task = tasks[record["task_id"]]
    definition = record["definition"]
    check = next(
        (item for item in task.get("evidence_checks", []) if item.get("id") == record["check_id"]), None
    )
    if not check or definition != {"cwd": task["project_path"], "check": check}:
        raise ValueError("Attempt definition does not match its planned check")
    if (not nonempty_text(record["id"]) or record["definition_digest"] != contract_digest(definition)
        or not revision or record["qa_revision"] != revision
        or task["status"] not in ("in_progress", "completed")
        or not nonempty_text(record["candidate"]) or not record["environment"]
        or not text_list(check["qa_ids"]) or set(check["qa_ids"]) - obligations.keys()):
        raise ValueError("Invalid check attempt start")


def validate_result(record, start):
    if (start["event"] != "started" or not nonempty_text(record["id"])
        or record["status"] not in ("observed", "inconclusive")
        or not record.get("artifact_ref") or not nonempty_text(record["candidate_after"])):
        raise ValueError("Invalid check attempt result")
    if record["status"] == "observed" and (
        start["candidate"] != record["candidate_after"]
        or start["environment"] != record["environment_after"]
        or type(record["exit_code"]) is not int
        or record.get("observed_values") is None
        or not text_list(record.get("test_refs"))
        or not text_list(record.get("assertions"))
    ):
        raise ValueError("Observed result requires stable identity and recorded observations")


def validate_new_evidence(evidence, old, tasks, previous, revision, obligations):
    finished = {record["attempt_id"] for record in old.values() if record.get("event") == "result"}
    for key, record in evidence.items():
        if key in old:
            continue
        if record.get("event") == "started":
            validate_start(record, tasks, revision, obligations)
            validate_start(record, previous, revision, obligations)
        elif record.get("event") == "result":
            attempt = record["attempt_id"]
            if attempt not in old or attempt in finished:
                raise ValueError("Result requires a previously persisted unfinished attempt")
            validate_result(record, old[attempt])
            finished.add(attempt)
        else:
            raise ValueError("Append new evidence as check attempt events")


def verify_finding_evidence(record, evidence, tasks, revision, obligations, assessment, obligation_id, status):
    if status != "INCONCLUSIVE":
        if obligations[obligation_id]["status"] == "pending":
            raise ValueError("Pending obligation requires an inconclusive finding")
        values = record.get("observed_values")
        if (values is None or isinstance(values, dict) and not values
                or isinstance(values, str) and not values.strip()):
            raise ValueError("A conclusive finding requires recorded observed values")
    if record.get("event") == "result":
        start = evidence[record["attempt_id"]]
        validate_start(start, tasks, revision, obligations)
        validate_result(record, start)
        if (start["candidate"] != assessment["candidate"] or start["qa_revision"] != revision
            or obligation_id not in start["definition"]["check"]["qa_ids"]):
            raise ValueError("Finding cites unrelated or stale evidence")
        if status != "INCONCLUSIVE":
            if record["status"] != "observed":
                raise ValueError("A conclusive finding requires an observed result")
            task = tasks.get(start["task_id"], {})
            if (task.get("project_path") != start["definition"]["cwd"]
                or start["definition"]["check"] not in task.get("evidence_checks", [])):
                raise ValueError("Finding cites a superseded check definition")
        if status == "PASS" and record.get("exit_code") != 0:
            raise ValueError("PASS cannot cite a failed check")
        return
    if record.get("event"):
        raise ValueError("Findings must cite results, not attempt starts")
    validate_legacy_evidence(record, tasks, revision, obligations)
    if (record["candidate"] != assessment["candidate"] or obligation_id not in record["qa_ids"]
        or status == "PASS" and record["exit_code"] != 0):
        raise ValueError("Finding cites unrelated, stale or failed evidence")


def validate_assessment(value, scope, revision, obligations, tasks):
    if (value["qa_revision"] != revision or value["scope_revision"] != scope
            or not value["candidate"]):
        raise ValueError("Assessment does not match current contract")
    if value["status"] not in ("PASS", "FAIL", "INCONCLUSIVE"):
        raise ValueError("Unknown assessment status")
    evidence = indexed(tasks.get("evidence", [])) if tasks else {}
    findings = indexed(value["findings"])
    if findings.keys() != obligations.keys():
        raise ValueError("Assess every obligation exactly once")
    blocking = []
    for key, finding in findings.items():
        status = finding["status"]
        refs = finding["evidence_ids"]
        if status not in ("PASS", "FAIL", "INCONCLUSIVE") or not finding["rationale"]:
            raise ValueError("Invalid finding")
        if not isinstance(refs, list) or any(not nonempty_text(ref) for ref in refs) or len(set(refs)) != len(refs):
            raise ValueError("Finding evidence_ids must be a list of unique, nonempty IDs")
        if status != "INCONCLUSIVE" and not refs:
            raise ValueError("A conclusive finding requires evidence")
        for ref in refs:
            verify_finding_evidence(evidence[ref], evidence, indexed(tasks["tasks"]),
                                    revision, obligations, value, key, status)
        if obligations[key]["blocking"]:
            blocking.append(status)
    expected = ("FAIL" if "FAIL" in blocking else
                "INCONCLUSIVE" if "INCONCLUSIVE" in blocking or value.get("contract_gap")
                else "PASS")
    if value["status"] != expected:
        raise ValueError("Assessment status contradicts its findings")


def artifact_bindings(assessment, document):
    """Bind local reviewed artifacts by content; never fetch untrusted remote references."""
    evidence = indexed(document.get('evidence', [])) if document else {}
    tasks = indexed(document.get('tasks', [])) if document else {}
    refs = {ref for finding in assessment['findings'] for ref in finding['evidence_ids']}
    bindings = []
    for key in sorted(refs):
        record = evidence[key]
        start = evidence.get(record.get('attempt_id'), record)
        artifact = record.get('artifact_ref')
        item = dict(id=key, artifact_ref=artifact, status=record.get('status'), exit_code=record.get('exit_code'))
        try:
            if not nonempty_text(artifact) or re.match(r'^[A-Za-z][A-Za-z0-9+.-]*://', artifact):
                raise ValueError('A local artifact snapshot is required')
            task = tasks[start['task_id']]
            root = Path(task['project_path']).resolve(strict=True)
            candidate = Path(artifact)
            file = (candidate if candidate.is_absolute() else root / candidate).resolve(strict=True)
            if not file.is_relative_to(root) or not file.is_file():
                raise ValueError('Artifact must be a local file within the task project')
            before = file.stat()
            data = file.read_bytes()
            after = file.stat()
            if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                raise ValueError('Artifact changed while reading')
            item['sha256'] = digest(data)
        except (ValueError, OSError, KeyError, TypeError) as error:
            item['error'] = str(error)
        bindings.append(item)
    return bindings


def candidate_id(root, folder, document):
    """Fingerprint project inputs; check artifacts and runtime state need separate identity."""
    root, folder = root.resolve(strict=True), folder.resolve(strict=True)
    if not root.is_dir() or not folder.is_relative_to(root):
        raise ValueError("The change folder must be inside the project root")
    roots = {root}
    for task in document.get("tasks", []):
        roots.add(Path(task["project_path"]).resolve(strict=True))
    source_paths = []
    specification = folder / 'context.sqlite'
    if specification.is_symlink():
        raise ValueError('Cannot fingerprint source references through a symlinked specification')
    if specification.is_file():
        if any((folder / ('context.sqlite' + suffix)).exists() for suffix in ('-wal', '-journal')):
            raise ValueError('New Scope specification is active; finish its transaction first')
        with sqlite3.connect(specification.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.execute('PRAGMA trusted_schema=OFF')
            for source_root, source_path in db.execute('SELECT project_root, path FROM sources'):
                source_root = Path(source_root).resolve(strict=True)
                roots.add(source_root)
                source_paths.append((source_root, source_path))
    qa, _ = read(folder / 'qa.json')
    qa_refs = [ref for obligation in (qa or {}).get('contract', {}).get('obligations', [])
               for ref in obligation.get('source_refs', []) if isinstance(ref, str)]
    always_ignored = {'.git', '.100x', '.project-mapper'}
    dependency_dirs = {'node_modules', '__pycache__', '.pytest_cache', '.venv', 'venv'}
    result = hashlib.sha256()
    for project in sorted(roots, key=str):
        if not project.is_dir():
            raise ValueError(f"Project root is not a directory: {project}")
        result.update(b'root\0' + os.fsencode(str(project)) + b'\0')
        declared = set()
        for source_root, source_path in source_paths:
            if source_root == project and not Path(source_path).is_absolute() and '..' not in Path(source_path).parts:
                declared.add(project / source_path)
        for ref in qa_refs:
            ref_path = Path(re.sub(r':\d+(?::\d+)?$', '', ref))
            if not ref_path.is_absolute() and '..' not in ref_path.parts and (len(ref_path.parts) > 1 or ref_path.suffix):
                declared.add(project / ref_path)
        for task in document.get('tasks', []):
            if Path(task['project_path']).resolve() != project:
                continue
            paths = list(task.get('files_allowed', [])) + list(task.get('unit_tests', {}).get('files', []))
            for check in task.get('evidence_checks', []):
                paths.extend(check.get('files', []))
            for raw in paths:
                if isinstance(raw, str) and not Path(raw).is_absolute() and '..' not in Path(raw).parts:
                    declared.add(project / raw)
        for current, dirs, files in os.walk(project, followlinks=False):
            current = Path(current)
            def included(name):
                target = current / name
                if name in always_ignored or target == folder:
                    return False
                if name not in dependency_dirs:
                    return True
                return any(target == item or target in item.parents or item in target.parents for item in declared)
            dirs[:] = sorted(name for name in dirs if included(name))
            if any((current / name).is_symlink() for name in dirs):
                raise ValueError(f"Cannot fingerprint a symlinked source directory under {current}")
            for name in sorted(files):
                file = current / name
                if file.is_symlink():
                    raise ValueError(f"Cannot fingerprint a symlinked source file: {file}")
                before = file.stat()
                data = file.read_bytes()
                after = file.stat()
                if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
                    raise ValueError(f"File changed while fingerprinting: {file}")
                result.update(os.fsencode(str(file.relative_to(project))) + b'\0')
                result.update(str(before.st_mode).encode() + b'\0' + hashlib.sha256(data).digest())
    return 'sha256:' + result.hexdigest()


def executor_module():
    script = Path(__file__).resolve().parents[1] / 'execute-scope' / 'contract.py'
    spec = importlib.util.spec_from_file_location('execute_scope_contract', script)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def plan_revision(document, executor):
    if not document:
        return None
    definition = {**{key: value for key, value in document.items() if key not in ('tasks', 'evidence')},
                  'tasks': [executor.task_definition(task) for task in document['tasks']]}
    return contract_digest(definition)


def qa_summary(folder, root, environments):
    scope_bytes = (folder / 'SCOPE.md').read_bytes()
    scope = digest(scope_bytes)
    qa, _ = read(folder / 'qa.json')
    tasks, _ = read(folder / 'tasks.json')
    contract = qa.get('contract') if qa else None
    if not contract or contract.get('scope_revision') != scope or contract.get('change_id') != folder.name:
        raise ValueError('Replan the missing or stale QA contract')
    if not tasks:
        raise ValueError('Publish the task plan first')
    revision = contract_digest(contract)
    obligations = validate_qa(contract, scope_bytes.decode(), folder)
    executor = executor_module()
    planned, _, blocked = executor.validate_task_contract(folder, tasks, scope, revision)
    candidate = candidate_id(root, folder, tasks)
    matches = [item for item in qa.get('assessments', []) if item.get('candidate') == candidate
               and item.get('scope_revision') == scope and item.get('qa_revision') == revision]
    incomplete = [key for key, task in planned.items() if executor.task_state(task) != ('completed', 'completed')]
    events = tasks.get('evidence', [])
    finished = {item['attempt_id'] for item in events if item.get('event') == 'result'}
    unfinished = [item['id'] for item in events if item.get('event') == 'started'
                  and item.get('candidate') == candidate and item['id'] not in finished]
    summary = dict(status='INCONCLUSIVE', candidate=candidate, scope_revision=scope,
                   qa_revision=revision, assessment=None, incomplete_tasks=incomplete,
                   blocked_tasks=sorted(blocked), unfinished_attempts=unfinished)
    if not matches:
        summary['reason'] = 'No current-candidate assessment is available.'
        return summary
    assessment = matches[-1]
    validate_assessment(assessment, scope, revision, obligations, tasks)
    summary['assessment'] = assessment
    current = {item['id']: item for item in artifact_bindings(assessment, tasks)}
    previous = {item['id']: item for item in assessment.get('artifact_bindings', [])}
    invalid = {key for key, item in current.items()
               if 'sha256' not in item or previous.get(key, {}).get('sha256') != item['sha256']
               or previous.get(key, {}).get('artifact_ref') != item['artifact_ref']}
    summary['evidence'] = list(current.values())
    summary['artifact_issues'] = sorted(invalid)
    by_id = indexed(events)
    environment_issues = []
    for finding in assessment['findings']:
        if not obligations[finding['id']]['blocking'] or finding['status'] == 'INCONCLUSIVE':
            continue
        for ref in finding['evidence_ids']:
            record = by_id[ref]
            start = by_id.get(record.get('attempt_id'), record)
            key = f"{start['task_id']}/{start.get('check_id', '')}"
            if key not in environments or environments[key] != start.get('environment'):
                environment_issues.append(key)
    summary['environment_issues'] = sorted(set(environment_issues))
    summary['environment_note'] = 'Current environments are caller-confirmed and must be observed independently.'
    effective_blocking = []
    for finding in assessment['findings']:
        if obligations[finding['id']]['blocking']:
            effective_blocking.append('INCONCLUSIVE' if invalid.intersection(finding['evidence_ids']) else finding['status'])
    summary['status'] = ('FAIL' if 'FAIL' in effective_blocking else
                         'INCONCLUSIVE' if 'INCONCLUSIVE' in effective_blocking or assessment.get('contract_gap')
                         else 'PASS')
    if invalid:
        summary['reason'] = 'Referenced artifacts are missing, inaccessible, changed or lack an assessment binding.'
    if assessment.get('plan_revision') != plan_revision(tasks, executor):
        summary['status'] = 'INCONCLUSIVE'
        summary['reason'] = 'The published task definitions changed or lack an assessment binding; reconcile and reassess.'
    elif summary['environment_issues'] and summary['status'] != 'FAIL':
        summary['status'] = 'INCONCLUSIVE'
        summary['reason'] = 'The current environment identity was not confirmed for every blocking check.'
    if summary['status'] == 'PASS' and (incomplete or blocked or unfinished):
        summary['status'] = 'INCONCLUSIVE'
        summary['reason'] = 'Some planned tasks or check attempts are incomplete or blocked.'
    elif summary['status'] == 'PASS' and assessment.get('evidence_revision') != contract_digest(events):
        summary['status'] = 'INCONCLUSIVE'
        summary['reason'] = 'The evidence history changed or predates the assessment binding; reassess it.'
    return summary


def qa_evidence(folder, candidate, obligation_id, limit):
    scope_bytes = (folder / "SCOPE.md").read_bytes()
    scope = digest(scope_bytes)
    qa, qa_digest = read(folder / "qa.json")
    contract = qa.get("contract") if qa else None
    if not contract or (contract["scope_revision"], contract["change_id"]) != (scope, folder.name):
        raise ValueError("Replan the missing, stale or legacy QA contract")
    revision = contract_digest(contract)
    obligations = validate_qa(contract, scope_bytes.decode(), folder)
    if obligation_id not in obligations:
        raise ValueError(f"Unknown QA obligation: {obligation_id}")
    document, tasks_digest = read(folder / "tasks.json")
    if document is not None:
        validate_blueprint(folder, document)
    document = document or {}
    tasks = indexed(document.get("tasks", []))
    evidence = indexed(document.get("evidence", []))
    finished = {row["attempt_id"] for row in evidence.values() if row.get("event") == "result"}
    results = dict(observed_results=[], excluded_results=[], unfinished_attempts=[])
    for record in reversed(list(evidence.values())):
        event = record.get("event")
        start = evidence.get(record["attempt_id"], {}) if event == "result" else record
        if start.get("event") == "started":
            links = start["definition"]["check"]["qa_ids"]
        else:
            links = start.get("qa_ids", [])
        if start.get("candidate") != candidate or obligation_id not in links:
            continue
        if event == "started":
            if record["id"] not in finished:
                results["unfinished_attempts"].append(record)
            continue
        try:
            # No verdict is supplied when projecting possible conclusive evidence.
            verify_finding_evidence(record, evidence, tasks, revision, obligations,
                                    {"candidate": candidate}, obligation_id, status=None)
        except (ValueError, KeyError, TypeError) as error:
            results["excluded_results"].append(dict(id=record["id"], reason=str(error)))
        else:
            results["observed_results"].append(dict(result=record, start=start if event == "result" else None))
    return dict(candidate=candidate, obligation=obligations[obligation_id], scope_revision=scope,
                qa_revision=revision, qa_digest=qa_digest, tasks_digest=tasks_digest,
                counts={key: len(rows) for key, rows in results.items()},
                **{key: rows[:limit] for key, rows in results.items()})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder", type=Path)
    parser.add_argument("operation", choices=("inspect", "plan", "build", "qa-plan", "qa-check", "qa-evidence", "scope", "candidate", "summary"))
    parser.add_argument("candidate", nargs="?", help="exact execution candidate for qa-evidence")
    parser.add_argument("--obligation", help="published QA obligation for qa-evidence")
    parser.add_argument("--limit", type=int, help="maximum records per result category for qa-evidence (default 5)")
    parser.add_argument("--expect", help="Current destination file digest, or absent")
    parser.add_argument("--project-root", type=Path, help="Project root for candidate or summary")
    parser.add_argument("--environment-json", help="Current environment identities keyed by task/check for summary")
    args = parser.parse_args()
    folder = args.folder
    if args.operation in ('candidate', 'summary'):
        if args.project_root is None:
            parser.error(f"{args.operation} requires --project-root")
        if args.operation == 'candidate':
            if args.environment_json is not None:
                parser.error('--environment-json is supported only by summary')
            document, _ = read(folder / 'tasks.json')
            print(json.dumps(dict(candidate=candidate_id(args.project_root, folder, document or {}))))
        else:
            environments = json.loads(args.environment_json) if args.environment_json else {}
            if not isinstance(environments, dict):
                raise ValueError('Current environments must be a JSON object')
            print(json.dumps(qa_summary(folder, args.project_root, environments), ensure_ascii=False))
        return
    if args.project_root is not None or args.environment_json is not None:
        parser.error('--project-root and --environment-json are supported only by candidate and summary')
    if args.operation == "qa-evidence":
        if not nonempty_text(args.candidate) or not nonempty_text(args.obligation):
            parser.error("qa-evidence requires a candidate and --obligation")
        limit = args.limit if args.limit is not None else 5
        if limit < 1:
            parser.error("--limit must be positive")
        print(json.dumps(qa_evidence(folder, args.candidate, args.obligation, limit), ensure_ascii=False))
        return
    if any(arg is not None for arg in (args.candidate, args.obligation, args.limit)):
        parser.error("candidate, --obligation and --limit are supported only by qa-evidence")
    proposed = None if args.operation == "inspect" else (
        sys.stdin.read() if args.operation == "scope" else json.load(sys.stdin)
    )
    with lock(folder):
        scope_path = folder / "SCOPE.md"
        scope_bytes = scope_path.read_bytes() if scope_path.exists() else None
        scope = digest(scope_bytes) if scope_bytes is not None else None
        if args.operation == "scope":
            if (folder / 'context.sqlite').exists() or (folder / 'context.sqlite').is_symlink():
                raise ValueError('New Scope owns this scope; render it from the specification')
            if args.expect != (scope or "absent") or not proposed.strip():
                raise ValueError("Scope changed or is empty")
            atomic_write(scope_path, proposed.encode())
            return
        if scope is None and args.operation != "inspect":
            raise ValueError("Create SCOPE.md first")
        tasks, tasks_digest = read(folder / "tasks.json")
        qa, qa_digest = read(folder / "qa.json")
        contract = qa.get("contract") if qa else None
        revision = contract_digest(contract) if contract is not None else None
        if args.operation == "inspect":
            print(json.dumps(dict(scope_revision=scope, qa_revision=revision,
                                  tasks_digest=tasks_digest, qa_digest=qa_digest)))
            return
        value = proposed
        task_write = args.operation in ("plan", "build")
        current_digest = tasks_digest if task_write else qa_digest
        if args.expect != (current_digest or "absent"):
            raise ValueError("Destination changed. Inspect and reconcile before retrying.")
        if args.operation == "qa-plan":
            if value["scope_revision"] != scope or value["change_id"] != folder.name:
                raise ValueError("QA contract has stale scope or wrong change ID")
            validate_qa(value, scope_bytes.decode(), folder, publishing=True)
            value = {"contract": value, "assessments": qa.get("assessments", []) if qa else []}
        else:
            if qa and (contract is None or contract["scope_revision"] != scope
                       or contract["change_id"] != folder.name):
                raise ValueError("Replan the stale or legacy QA contract")
            obligations = validate_qa(contract, scope_bytes.decode(), folder) if contract else {}
            if task_write:
                validate_blueprint(folder, value)
                if (value["scope_revision"], value.get("qa_revision"), value["change_id"]) != (
                    scope, revision, folder.name
                ):
                    raise ValueError("Task plan revision mismatch")
                planned = indexed(value["tasks"])
                phases = validate_tasks(planned)
                previous = indexed(tasks["tasks"]) if tasks else {}
                blocked = indexed(value.get("blocked_tasks", []))
                if blocked.keys() & planned.keys():
                    raise ValueError("Executable and blocked task IDs must be disjoint")
                if args.operation == "plan":
                    validate_replan(
                        planned, previous, phases,
                        bool(tasks) and tasks["scope_revision"] != scope,
                        bool(tasks) and tasks.get("qa_revision") != revision,
                    )
                for key, task in planned.items():
                    if args.operation == "build":
                        validate_transition(previous[key], task, phases[key])
                        if task_state(task) != task_state(previous[key]) and any(
                            task_state(previous[dep["task"]]) != ("completed", "completed")
                            for dep in task["depends_on"]
                        ):
                            raise ValueError("Task dependencies are incomplete")
                    links = set(task.get("qa_ids", []))
                    for check in task.get("evidence_checks", []):
                        links.update(check["qa_ids"])
                    if links - obligations.keys():
                        raise ValueError("Unknown QA obligation")
                evidence = indexed(value.get("evidence", []))
                old_evidence = indexed(tasks.get("evidence", [])) if tasks else {}
                if any(evidence.get(key) != record for key, record in old_evidence.items()):
                    raise ValueError("Evidence history is append-only")
                if args.operation == "plan" and evidence != old_evidence:
                    raise ValueError("Only build may append evidence")
                if args.operation == "build":
                    def definition(document):
                        return {**{k: v for k, v in document.items() if k not in ("tasks", "evidence")},
                                "tasks": [task_definition(task) for task in document["tasks"]]}
                    if not tasks or definition(value) != definition(tasks):
                        raise ValueError("Build cannot change the plan")
                    validate_new_evidence(evidence, old_evidence, planned, previous, revision, obligations)
            else:
                if args.operation == 'qa-check' and tasks:
                    validate_blueprint(folder, tasks)
                if not contract:
                    raise ValueError("Assessment does not match current contract")
                assessments = qa.get("assessments", [])
                if value["id"] in indexed(assessments):
                    raise ValueError("Assessment ID already exists")
                validate_assessment(value, scope, revision, obligations, tasks)
                value = {**value, 'evidence_revision': contract_digest(tasks.get('evidence', []) if tasks else []),
                         'artifact_bindings': artifact_bindings(value, tasks),
                         'plan_revision': plan_revision(tasks, executor_module())}
                value = {**qa, "assessments": [*assessments, value]}
        save(folder / ("tasks.json" if task_write else "qa.json"), value)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, TypeError, sqlite3.Error) as error:
        sys.exit(str(error))
