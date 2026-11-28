# Evidence identity and portability

Candidate IDs use `sha256:v2:` and logical project roots, so moving an unchanged
checkout does not change its identity. Earlier candidate identities remain
historical; rerun the relevant checks and reassess under v2 rather than claiming
that an old assessment covers the new identity.

For each planned check declaring `runtime_artifacts`, use
`100x workbench qa <change-folder> runtime-artifacts --project-root ROOT --task-id T1 --check-id CHECK`
to obtain the current `artifacts` map. Record it as `runtime_artifacts` in the
start event and repeat the command after execution, recording
`runtime_artifacts_after` in the result. A conclusive observed result requires
equal before/after maps; summary becomes inconclusive if a declared runtime file
later changes or is missing. This verifies local files, not which remote
deployment or process was actually exercised: establish that link and the
live environment independently.

To transfer a current assessment, use
`100x workbench qa <change-folder> export-evidence --project-root ROOT --bundle /safe/location/evidence.zip`
and, in an equivalent checkout, use
`100x workbench qa <change-folder> import-evidence --project-root NEW_ROOT --bundle /safe/location/evidence.zip`.
The bundle carries the relevant contracts, cited artifacts and declared runtime
products; outputs are restored only into declared generated-output paths, and
different existing files are never overwritten. External project roots require
an explicit `--root-map-json '{"/old/external":"/new/external"}'`; imported
root mappings are saved for subsequent commands. Source inputs must match, and
the current environment must be independently observed and provided again to
`summary`. Imported artifacts outside `.100x/evidence` are held as local
snapshots, identified in the summary. Bundles contain file contents and original
paths and may contain sensitive information: protect them appropriately. SHA-256
detects accidental changes but does not authenticate who created a bundle.
