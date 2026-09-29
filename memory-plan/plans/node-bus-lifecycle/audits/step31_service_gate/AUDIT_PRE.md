# Scheduled application execution pause — 2026-09-29 03:11:58 EDT

## Micro re-orient

Bus-client drain/readiness steps are closed. Recovery1.2 cannot safely unload
scheduled jobs using empty logs or a transient missing PID. Claude50/52 and
actual exec-lock controls identify a smaller application-quiescence mechanism.
A source prototype was exercised during read-only/owned preflight. Formalize
it here; production integration is a distinct queued step. Both chains stay off.

## Goal and contract

A durable owner-private closed marker precedes an exclusive flock drain.
Runners take a nonblocking shared lock, validate metadata and inspect that
marker before exec. An inherited descriptor keeps the foreground application
locked until normal exit. Closed runs return0 without application work/logs;
invalid/missing/symlink metadata returns78 without application work/logs.
No OS-spawn coverage or arbitrary descendant drain is claimed.

## Locked choices and needs

D15 records the runtime-hold exception to recoveryD8. Python3/fcntl, installed
Node, real macOS launchd and actual vnode watches exist on this node. Node
children may close unknown descriptors; the foreground audit and consolidation
notification completion remain step3.2 needs, not hidden assumptions.

## Deltas

workspace-bin/service_gate.py implements only the owned execution/hold primitive
and explicit recovery API. test/service_gate_test.py runs real Node/shell
processes and an isolated scheduled launchd job; test/service-gate.test.mjs
includes those tests in existing isolated CI. No service template, loaded unit,
production marker or installer behavior changes in this step.

## Verification and remaining work

Eighteen owned tests pass, including actual scheduled starts staying inert
after controller exit, invalid metadata, inode replacement, deadline refusal,
explicit reopen and kernel rewrite detection. Private source pins/logs are
in PRIMITIVE_EVIDENCE.json. New exact CI and independent review remain needed.
Node/shell exec negative controls show lost locks without explicit inheritance.
Linux generic locks run, but continuous inode-watch acceptance is unproved.
The complete installed timer and restoration mechanism remains3.2.

## Mid-implementation correction

Prepare/fsync the marker under a fresh private name, then publish via an
exclusive atomic hard link before draining. A pre-publication sync fault has
no accepted close; a post-publication directory sync fault retains a valid
closed marker. Both faults preserve forensic staging bytes.18 fresh owned
controls pass against private primitive-v2. No production operation occurred.
