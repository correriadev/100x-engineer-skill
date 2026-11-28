"""Export and restore assessed evidence without rewriting its history."""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath, PureWindowsPath
import re
import sqlite3
import stat
import zipfile


FORMAT = '100x-portable-evidence-v1'
CONTRACT_NAMES = {'SCOPE.md', 'tasks.json', 'qa.json', 'context.sqlite'}
REQUIRED_CONTRACTS = {'SCOPE.md', 'tasks.json', 'qa.json'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def relative_path(value):
    if not isinstance(value, str) or not value:
        raise ValueError('A portable path must be a nonempty string')
    path = PurePosixPath(value)
    if (path.is_absolute() or path.as_posix() != value or not path.parts or '..' in path.parts
            or re.search(r'[\\:*?\x00-\x1f]', value)):
        raise ValueError('A portable path must stay inside its project')
    return path


def safe_target(root, relative):
    path = relative_path(relative)
    current = root
    for part in path.parts:
        current = current / part
        if current.is_symlink():
            raise ValueError('Portable evidence path traverses a symlink')
    return current


def runtime_digests(task, check, mapping, api):
    """Read planned runtime files, keeping their identity separate from source inputs."""
    paths = check.get('runtime_artifacts', [])
    if not isinstance(paths, list) or any(not isinstance(path, str) for path in paths):
        raise ValueError('Invalid runtime artifact paths')
    api.validate_runtime_artifacts(check, {'runtime_artifacts': {path: 'sha256:' + '0' * 64 for path in paths}})
    project = api.mapped_root(task['project_path'], api.root_mapping(mapping))
    result = {}
    for path in paths:
        file = safe_target(project, path)
        if not file.is_file():
            raise ValueError(f'Runtime artifact is unavailable: {path}')
        before = file.stat()
        data = file.read_bytes()
        after = file.stat()
        if (before.st_size, before.st_mtime_ns, before.st_ino) != (after.st_size, after.st_mtime_ns, after.st_ino):
            raise ValueError(f'Runtime artifact changed while reading: {path}')
        result[path] = 'sha256:' + sha(data)
    return result


def load_state(root, folder):
    root = Path(root).resolve(strict=True)
    state_path = safe_target(root, f'.100x/evidence-root-maps/{folder.name}.json')
    if not state_path.exists():
        return {}, {}
    state = json.loads(state_path.read_text(encoding='utf-8'))
    if (not isinstance(state, dict) or state.get('version') != 1 or state.get('change_id') != folder.name
            or not isinstance(state.get('roots'), dict) or not isinstance(state.get('snapshots'), dict)):
        raise ValueError('Portable evidence mapping is invalid')
    snapshots = {}
    for key, value in state['snapshots'].items():
        if not isinstance(key, str) or not re.fullmatch(r'[0-9a-f]{64}', value or ''):
            raise ValueError('Portable artifact mapping is invalid')
        snapshots[key] = safe_target(root, f'.100x/portable-evidence/{folder.name}/objects/{value}')
    return state['roots'], snapshots


def merge_mapping(saved, supplied):
    if not isinstance(supplied, dict):
        raise ValueError('Root mapping must be an object')
    if any(key in saved and saved[key] != value for key, value in supplied.items()):
        raise ValueError('Explicit root mapping conflicts with the imported evidence')
    return {**saved, **supplied}


def raw_roots(folder, tasks):
    result = {task['project_path'] for task in tasks.get('tasks', [])}
    database = folder / 'context.sqlite'
    if database.is_file():
        with sqlite3.connect(database.resolve().as_uri() + '?mode=ro', uri=True) as db:
            db.execute('PRAGMA trusted_schema=OFF')
            result.update(row[0] for row in db.execute('SELECT project_root FROM sources'))
    return sorted(result)


def export_evidence(folder, root, bundle, mapping, snapshots, api):
    root, folder = root.resolve(strict=True), folder.resolve(strict=True)
    if not folder.is_relative_to(root):
        raise ValueError('The change folder must be inside the project root')
    scope = (folder / 'SCOPE.md').read_bytes()
    tasks, tasks_digest = api.read(folder / 'tasks.json')
    qa, qa_digest = api.read(folder / 'qa.json')
    if not tasks or not qa or not isinstance(qa.get('contract'), dict):
        raise ValueError('Publish the QA contract and task plan before exporting evidence')
    revision = api.contract_digest(qa['contract'])
    obligations = api.validate_qa(qa['contract'], scope.decode(), folder)
    api.executor_module().validate_task_contract(folder, tasks, sha(scope), revision)
    candidate = api.candidate_id(root, folder, tasks, mapping)
    assessments = [item for item in qa.get('assessments', [])
                   if item.get('candidate') == candidate and item.get('scope_revision') == sha(scope)
                   and item.get('qa_revision') == revision]
    if not assessments:
        raise ValueError('No assessment matches the current candidate and contracts')
    assessment = assessments[-1]
    api.validate_assessment(assessment, sha(scope), revision, obligations, tasks)
    current = api.artifact_bindings(assessment, tasks, mapping, snapshots)
    expected = {item['id']: item for item in assessment.get('artifact_bindings', [])}
    for item in current:
        if ('sha256' not in item or item['sha256'] != expected.get(item['id'], {}).get('sha256')
                or item['artifact_ref'] != expected.get(item['id'], {}).get('artifact_ref')):
            raise ValueError('An assessed artifact is missing or changed; reassess before export')

    evidence = api.indexed(tasks.get('evidence', []))
    task_index = api.indexed(tasks['tasks'])
    objects = {}
    contracts = []
    for name in sorted(CONTRACT_NAMES):
        path = folder / name
        if path.is_symlink():
            raise ValueError('A contract cannot be a symlink')
        if path.is_file():
            data = path.read_bytes()
            digest = sha(data)
            expected_digest = {'SCOPE.md': sha(scope), 'tasks.json': tasks_digest, 'qa.json': qa_digest,
                               'context.sqlite': (tasks.get('blueprint_source') or {}).get('sha256')}.get(name)
            if expected_digest is not None and digest != expected_digest:
                raise ValueError('A contract changed while exporting evidence')
            objects[digest] = data
            contracts.append(dict(name=name, sha256=digest))
        elif name in REQUIRED_CONTRACTS:
            raise ValueError('A required contract is missing')
    artifacts = []
    runtime_artifacts = []
    validated_mapping = api.root_mapping(mapping)
    for binding in current:
        record = evidence[binding['id']]
        start = evidence.get(record.get('attempt_id'), record)
        task = task_index[start['task_id']]
        if binding['id'] in snapshots:
            file = snapshots[binding['id']]
            relative = api.artifact_reference(task, record['artifact_ref'])
        else:
            _, relative, file = api.artifact_location(task, record['artifact_ref'], validated_mapping)
        data = file.read_bytes()
        digest = sha(data)
        if digest != binding['sha256']:
            raise ValueError('Artifact changed while exporting')
        objects[digest] = data
        artifacts.append(dict(id=binding['id'], root=task['project_path'], path=relative.as_posix(), sha256=digest))
        if start.get('runtime_artifacts'):
            actual = runtime_digests(task, start['definition']['check'], mapping, api)
            if actual != start['runtime_artifacts']:
                raise ValueError('A runtime artifact differs from the assessed execution')
            for path, value in sorted(actual.items()):
                file = safe_target(validated_mapping.get(task['project_path'], Path(task['project_path'])), path)
                product = file.read_bytes()
                product_digest = sha(product)
                if value != 'sha256:' + product_digest:
                    raise ValueError('Runtime artifact changed while exporting')
                objects[product_digest] = product
                runtime_artifacts.append(dict(id=binding['id'], root=task['project_path'], path=path,
                                              sha256=product_digest, executable=bool(file.stat().st_mode & 0o111)))
    original_root = next((key for key, value in validated_mapping.items() if value == root), str(root))
    manifest = dict(format=FORMAT, change_id=folder.name, change_path=folder.relative_to(root).as_posix(),
                    original_root=original_root, roots=raw_roots(folder, tasks), candidate=candidate,
                    assessment_id=assessment['id'], contracts=contracts, artifacts=artifacts,
                    runtime_artifacts=runtime_artifacts)
    bundle = bundle.resolve()
    if bundle.is_relative_to(root) and not bundle.is_relative_to(root / '.100x'):
        raise ValueError('Write the bundle outside the project or under .100x')
    if bundle.exists() or bundle.is_symlink():
        raise ValueError('Evidence bundle destination already exists')
    created = False
    try:
        with bundle.open('xb') as output:
            created = True
            with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_STORED) as archive:
                archive.writestr('manifest.json', json.dumps(manifest, sort_keys=True, ensure_ascii=True))
                for digest, data in sorted(objects.items()):
                    archive.writestr('objects/' + digest, data)
    except BaseException:
        if created:
            bundle.unlink(missing_ok=True)
        raise
    return dict(bundle=str(bundle), candidate=candidate, artifacts=len(artifacts), status='exported')


def local_roots(manifest, root, supplied):
    original = manifest['original_root']
    flavor = PureWindowsPath if PureWindowsPath(original).is_absolute() else PurePosixPath
    if not flavor(original).is_absolute() or not isinstance(supplied, dict):
        raise ValueError('Portable root mapping is invalid')
    mapping = {}
    for source in manifest['roots']:
        source_flavor = PureWindowsPath if isinstance(source, str) and PureWindowsPath(source).is_absolute() else PurePosixPath
        if not isinstance(source, str) or not source_flavor(source).is_absolute():
            raise ValueError('Portable source root is invalid')
        if source in supplied:
            current = supplied[source]
        else:
            try:
                if source_flavor != flavor:
                    raise ValueError('Different path flavors')
                relative = flavor(source).relative_to(flavor(original))
            except ValueError:
                raise ValueError('An external project root requires an explicit mapping') from None
            current = str(root.joinpath(*relative.parts))
        mapping[source] = current
    if original in supplied and Path(supplied[original]).resolve() != root:
        raise ValueError('The original project root must map to the current project root')
    mapping[original] = str(root)
    if set(supplied) - set(mapping):
        raise ValueError('Root mapping contains an unknown source root')
    return mapping


def import_evidence(folder, root, bundle, supplied, api):
    root = root.resolve(strict=True)
    folder = folder.absolute()
    if not folder.is_relative_to(root) or not root.is_dir():
        raise ValueError('The change folder must be inside the project root')
    folder = safe_target(root, folder.relative_to(root).as_posix())
    with zipfile.ZipFile(bundle, 'r') as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or 'manifest.json' not in names:
            raise ValueError('Evidence bundle has duplicate or missing members')
        if any(item.compress_type != zipfile.ZIP_STORED for item in archive.infolist()):
            raise ValueError('Evidence bundle members must use the stored format')
        manifest = json.loads(archive.read('manifest.json'))
        if (not isinstance(manifest, dict) or manifest.get('format') != FORMAT
                or manifest.get('change_id') != folder.name
                or relative_path(manifest.get('change_path')) != PurePosixPath(folder.relative_to(root).as_posix())
                or not isinstance(manifest.get('roots'), list) or not isinstance(manifest.get('contracts'), list)
                or not isinstance(manifest.get('artifacts'), list)
                or not isinstance(manifest.get('runtime_artifacts', []), list)):
            raise ValueError('Evidence bundle does not match the requested change')
        contracts = {item['name']: item['sha256'] for item in manifest['contracts']}
        if len(contracts) != len(manifest['contracts']) or not REQUIRED_CONTRACTS <= contracts.keys() or set(contracts) - CONTRACT_NAMES:
            raise ValueError('Evidence bundle contains invalid contracts')
        entries = [*manifest['contracts'], *manifest['artifacts'], *manifest.get('runtime_artifacts', [])]
        if any(not isinstance(item, dict) or not re.fullmatch(r'[0-9a-f]{64}', item.get('sha256', '')) for item in entries):
            raise ValueError('Evidence bundle has an invalid object digest')
        digests = {item['sha256'] for item in entries}
        if set(names) != {'manifest.json', *('objects/' + digest for digest in digests)}:
            raise ValueError('Evidence bundle has unexpected or missing objects')
        objects = {}
        for digest in digests:
            data = archive.read('objects/' + digest)
            if sha(data) != digest:
                raise ValueError('Evidence bundle object digest mismatch')
            objects[digest] = data

    tasks = json.loads(objects[contracts['tasks.json']])
    qa = json.loads(objects[contracts['qa.json']])
    task_index = api.indexed(tasks['tasks'])
    evidence = api.indexed(tasks.get('evidence', []))
    assessment = next((item for item in qa.get('assessments', [])
                       if item.get('id') == manifest.get('assessment_id')
                       and item.get('candidate') == manifest.get('candidate')), None)
    if assessment is None:
        raise ValueError('Evidence bundle lacks its candidate assessment')
    expected = {item['id']: item for item in assessment.get('artifact_bindings', [])}
    refs = {ref for finding in assessment['findings'] for ref in finding['evidence_ids']}
    artifacts = manifest['artifacts']
    if len({item['id'] for item in artifacts}) != len(artifacts) or {item['id'] for item in artifacts} != refs:
        raise ValueError('Evidence bundle does not contain the assessed artifacts')
    mapping = local_roots(manifest, root, supplied)
    resolved = api.root_mapping(mapping)
    writes = []
    for name, digest in contracts.items():
        writes.append((safe_target(folder, name), objects[digest]))
    snapshots = {}
    for item in artifacts:
        record = evidence[item['id']]
        start = evidence.get(record.get('attempt_id'), record)
        task = task_index[start['task_id']]
        if (task['project_path'] != item['root'] or item['sha256'] != expected.get(item['id'], {}).get('sha256')
                or record.get('artifact_ref') != expected.get(item['id'], {}).get('artifact_ref')):
            raise ValueError('Portable artifact does not match the assessment')
        original = task['project_path']
        flavor = PureWindowsPath if PureWindowsPath(original).is_absolute() else PurePosixPath
        reference = flavor(record['artifact_ref'])
        if reference.is_absolute():
            reference = reference.relative_to(flavor(original))
        if relative_path(item['path']).parts != reference.parts:
            raise ValueError('Portable artifact path differs from its recorded reference')
        if reference.parts[:2] == ('.100x', 'evidence'):
            target = safe_target(resolved[original], item['path'])
        else:
            snapshots[item['id']] = item['sha256']
            target = safe_target(root, f'.100x/portable-evidence/{folder.name}/objects/{item["sha256"]}')
        writes.append((target, objects[item['sha256']]))
    runtime = manifest.get('runtime_artifacts', [])
    expected_runtime = {}
    for ref in refs:
        record = evidence[ref]
        start = evidence.get(record.get('attempt_id'), record)
        for path, value in start.get('runtime_artifacts', {}).items():
            expected_runtime[(ref, path)] = (task_index[start['task_id']]['project_path'], value)
    actual_runtime = {(item['id'], item['path']): (item['root'], 'sha256:' + item['sha256']) for item in runtime}
    if len(actual_runtime) != len(runtime) or actual_runtime != expected_runtime:
        raise ValueError('Portable runtime artifacts do not match the assessed checks')
    originals = {current: original for original, current in resolved.items()}
    outputs = api.generated_output_paths(root, qa['contract'].get('candidate_policy'), set(),
                                         manifest['original_root'], originals)
    executable_targets = set()
    for item in runtime:
        if type(item.get('executable')) is not bool:
            raise ValueError('Portable runtime artifact has an invalid executable flag')
        target = safe_target(resolved[item['root']], item['path'])
        if item['executable']:
            executable_targets.add(target)
            if os.name != 'nt' and target.exists() and not target.stat().st_mode & 0o111:
                raise ValueError('Existing runtime artifact is not executable')
        if not any(target == output or target.is_relative_to(output) for output in outputs):
            if not target.is_file() or sha(target.read_bytes()) != item['sha256']:
                raise ValueError('A runtime artifact outside generated outputs must already match the checkout')
            continue
        writes.append((target, objects[item['sha256']]))
    state = dict(version=1, change_id=folder.name, roots=mapping, snapshots=snapshots)
    writes.append((safe_target(root, f'.100x/evidence-root-maps/{folder.name}.json'),
                   (json.dumps(state, sort_keys=True, indent=2) + '\n').encode()))
    unique = {}
    for target, data in writes:
        if target in unique and unique[target] != data:
            raise ValueError('Portable files conflict at the same destination')
        unique[target] = data
        if target.exists() and (not target.is_file() or target.read_bytes() != data):
            raise ValueError(f'Portable evidence would overwrite an existing file: {target}')
    created = []
    try:
        for target, data in unique.items():
            if target.exists():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            # Recheck after creating parents, and use exclusive creation to avoid
            # replacing an existing file if another process wrote it meanwhile.
            if any(part.is_symlink() for part in (target, *target.parents) if part != part.parent):
                raise ValueError('Portable evidence path traverses a symlink')
            with target.open('xb') as output:
                created.append(target)
                output.write(data)
            if target in executable_targets and os.name != 'nt':
                target.chmod(stat.S_IMODE(target.stat().st_mode) | 0o111)
        current = api.candidate_id(root, folder, tasks, mapping)
        if current != manifest['candidate']:
            raise ValueError('Current project inputs do not match the exported candidate')
        scope = (folder / 'SCOPE.md').read_bytes()
        contract = qa['contract']
        revision = api.contract_digest(contract)
        if contract.get('scope_revision') != sha(scope) or contract.get('change_id') != folder.name:
            raise ValueError('Imported QA contract does not match the scope')
        obligations = api.validate_qa(contract, scope.decode(), folder)
        api.executor_module().validate_task_contract(folder, tasks, sha(scope), revision)
        api.validate_assessment(assessment, sha(scope), revision, obligations, tasks)
        saved, local_snapshots = load_state(root, folder)
        bindings = api.artifact_bindings(assessment, tasks, saved, local_snapshots)
        if any(item.get('sha256') != expected.get(item['id'], {}).get('sha256') for item in bindings):
            raise ValueError('Imported artifacts do not match the assessment')
        for ref in refs:
            record = evidence[ref]
            start = evidence.get(record.get('attempt_id'), record)
            if start.get('runtime_artifacts') and runtime_digests(task_index[start['task_id']],
                    start['definition']['check'], saved, api) != start['runtime_artifacts']:
                raise ValueError('Imported runtime artifacts do not match the assessment')
    except BaseException:
        for target in reversed(created):
            target.unlink(missing_ok=True)
        raise
    return dict(candidate=manifest['candidate'], artifacts=len(artifacts), status='imported',
                note='Reconfirm the current environment before using an assessment.')
