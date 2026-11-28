# Formal verification

How 100x pulls checkable properties out of software, checks them, and keeps them true. Back to the [README](../README.md).

## The idea

You cannot formally verify an arbitrary program as a whole. You can pull formally checkable properties out of almost any software that is well defined enough to describe. So 100x does not try to prove the whole app. It cuts the work into small blocks, states six kinds of property for each block, checks them, then checks the blocks together.

## The six properties

For a tip splitter, one block:

| Ask | Example |
|---|---|
| State | a bill in cents, a number of people, a tip percent, and either no result yet or one share per person |
| Transitions | set the bill, set the people, set the tip, compute |
| Preconditions | compute needs a bill of at least one cent and at least one person |
| Postconditions | after compute, the shares add up to the bill plus the tip, one share per person |
| Invariants | no share is negative, and two shares never differ by more than one cent |
| Liveness | from any state with a valid bill and people, a result is eventually computed, if the caller keeps asking |

Each one has to be something that can be false. "Money is handled correctly" is not a property. "Shares add up to the bill plus the tip, to the cent" is.

## The checker

`skills/100x/assets/property-checker.mjs` is a small explicit-state checker with no dependencies. You give it a model: the start state, the steps with their preconditions and postconditions, the invariants and the liveness lines. Each step calls your project's own function. The checker then:

- visits every reachable state and checks the invariants on each
- runs the real function on every allowed case and every refused case, and fails when the code and the spec disagree about when a step may run (the `guard` lines)
- checks each postcondition on every step it finds
- reports a deadlock, and any step that was never possible
- decides each liveness line under a named fairness: every step that stays possible is eventually taken
- prints the shortest steps to a failure

If the search stops at a limit, it says BOUNDED and decides no liveness line.

## Blocks and the system

A block is a small piece of software with a clear contract: what it needs, and what it guarantees. 100x gives each block its own ledger row and its own failing run on a planted bug. Then it checks the whole:

1. **The seams.** Where block A hands a value to block B, A's guarantee has to meet B's precondition. In the system model this is B's `pre` and a guard line, so a disagreement fails as a named property.
2. **The system model.** One model whose steps call the real functions of several blocks in the order the product uses them. The checker visits every state of that model, so a bad interaction between blocks shows up as a short list of steps.
3. **A row for the system.** The system model is one more ledger row that covers every block it calls, so a change to any of them makes it stale.

What this does not do: it does not prove properties you never wrote down, and a system model leaves out what it does not model, such as concurrent callers, the clock or the network. The assumptions are printed with every result.

## The ledger

`verify/ledger.tsv` and `verify/history.tsv` live in the project, tracked by git, so they travel with every branch.

| Column | What it holds |
|---|---|
| id, kind, property | the name, which of the six, and one plain sentence |
| covers, covers_hash | the files or folders the property is about, and a hash of their contents |
| command, level | how to check it, and what the check really does: exhaustive, bounded or sampled |
| red | the failing run on a planted bug, which must hold a FAIL line |
| status, checked_at, commit | the last result, when, and at which commit |

A row is **holds** (green, current, and it has failed once on a planted bug), **stale** (the covered code changed after the last sync), **broken** (the last run failed), **unproven** (green but never seen failing) or **unchecked** (never run). A green run does not move the sync. Only `100x verify sync` does, and only after a green run on the code as it is now and a written note.

| Command | What it does |
|---|---|
| `100x verify status` | state of every row, exit 1 unless all hold |
| `100x verify cover <path>` | which rule covers this code, or NO RULE |
| `100x verify gaps` | every code file with no rule and no waiver |
| `100x verify add`, `run`, `sync` | record a property, run it, move its sync forward |
| `100x verify amend`, `retire` | change a promise on purpose, or drop it, with the reason in the log |
| `100x verify waive` | record that some code has nothing to state, with the reason |

`run` executes the command of each row, like `npm test` runs a script of package.json. Read the ledger of a project you did not write before you run it. `status`, `cover` and `gaps` run nothing.

The bundled checker reports its actual level in text or JSON. A generic command must print a line `VERIFICATION_LEVEL: exhaustive`, `VERIFICATION_LEVEL: bounded`, or `VERIFICATION_LEVEL: sampled`; exit zero alone does not establish a level. An exhaustive ledger claim is rejected when the result is bounded or sampled. Existing generic checks need to add that line before they can run successfully.

Waivers bind to the covered files and their contents, including files added to a covered directory. A changed or missing path makes the waiver stale: `status`, `cover`, `gaps` and completion no longer treat it as valid. Inspect the change and use `100x verify waive <path> --why "<reason>"` to record a fresh decision, or retire it and add a property.

## When there is no rule

Before an agent builds or changes code that carries logic, it runs `100x verify cover`. NO RULE starts the procedure: write the six properties, check them with the checker or a tool that fits, show each one fail on a planted bug, and record it. Code with nothing to state, such as layout or copy, gets a waiver and a reason. `100x finish` refuses an empty, stale, broken or never-failed ledger, and names the code each waiver excuses.

## Turning it off

It is on by default. Say `no verification` in the brief for one run, run `100x config set verify.enabled false --local` for one project, or `--global` for all of them. The `100x-mockup` mode skips it. When it is off, the report says nothing was verified.

## Other tools

The checker is the cheapest tool that can fail. When events can happen in a bad order across several actors, a model checker such as TLA+ fits better, and when a property must hold at every size, a prover does. The ledger takes any command, so those checks are recorded the same way. The procedure and the choice between them are in [the skill's guide](../skills/100x/references/properties.md).
