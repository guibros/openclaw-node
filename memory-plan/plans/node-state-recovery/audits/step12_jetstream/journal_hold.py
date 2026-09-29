import copy
import secrets

from preservation_checks import require
from preservation_journal import matches, valid_record


ANCHOR = 'scheduler-heartbeat'
TIMERS = frozenset((ANCHOR, 'consolidation-scheduler', 'observer',
                    'transcript-archive', 'log-rotate'))
REASON = 'preservation execution hold'


def describe(gate, cohort):
    gate.validate()
    require(gate.marker() is None, 'execution hold baseline must start open')
    require(isinstance(cohort, (list, tuple)) and cohort and len(set(cohort)) == len(cohort)
            and ANCHOR in cohort and set(cohort) <= TIMERS, 'execution hold timer cohort is invalid')
    return {'root': str(gate.root), 'pins': {'root': gate.expected_root, 'lock': gate.expected_lock},
            'metadata': copy.deepcopy(gate.metadata), 'metadata_identity': copy.deepcopy(gate.metadata_identity),
            'metadata_sha256': gate.metadata_sha, 'paths': gate.paths.evidence()['paths'],
            'cohort': list(cohort)}


class JournaledHold:
    def __init__(self, journal, gate, fast_check, seconds=5):
        self.journal = journal
        self.gate = gate
        self.fast_check = fast_check
        self.seconds = seconds
        self.guard = None
        self.original_session = None
        self._closing = False
        self.restore_only = journal.reopened
        self.baseline = journal.records[0]['sha256']
        self.saved = copy.deepcopy(journal.prior[ANCHOR].get('execution_hold'))
        require(isinstance(self.saved, dict) and set(self.saved) ==
                {'root', 'pins', 'metadata', 'metadata_identity', 'metadata_sha256', 'paths', 'cohort'},
                'execution hold baseline is incomplete')
        require(callable(fast_check), 'execution hold requires a fast final readiness check')
        cohort = self.saved['cohort']
        require(isinstance(cohort, list) and cohort and len(set(cohort)) == len(cohort)
                and ANCHOR in cohort and set(cohort) <= TIMERS
                and all(journal.prior[unit]['class'] == 'timer' for unit in cohort),
                'baselined execution hold timer cohort is invalid')
        self.validate()

    def validate(self):
        valid_record(self.journal.records[0])
        require(self.journal.prior == self.journal.records[0]['prior']
                and self.saved == self.journal.prior[ANCHOR]['execution_hold'],
                'execution hold durable baseline changed')
        self.gate.validate()
        require(str(self.gate.root) == self.saved['root']
                and {'root': self.gate.expected_root, 'lock': self.gate.expected_lock} == self.saved['pins']
                and self.gate.metadata == self.saved['metadata']
                and self.gate.metadata_identity == self.saved['metadata_identity']
                and self.gate.metadata_sha == self.saved['metadata_sha256']
                and self.gate.paths.evidence()['paths'] == self.saved['paths'],
                'execution hold immutable baseline changed; pin recapture is forbidden')

    def intents(self):
        rows = [row for row in self.journal.records if row['event'] == 'intent' and 'hold' in row]
        for row in rows:
            value = row['hold']
            require(isinstance(value, dict) and set(value) == {'baseline', 'window', 'reason', 'protective'}
                    and value['baseline'] == self.baseline and value['reason'] == REASON
                    and isinstance(value['protective'], bool) and isinstance(value['window'], str)
                    and len(value['window']) == 69 and value['window'].startswith('hold-')
                    and all(c in '0123456789abcdef' for c in value['window'][5:]),
                    'execution hold intent differs from its immutable baseline')
        require(len({row['hold']['window'] for row in rows}) == len(rows), 'duplicate execution hold window')
        ended = {row['intent'] for row in self.journal.records
                 if row['event'] in ('hold-superseded', 'hold-opened')}
        live = [row for row in rows if row['sequence'] not in ended]
        require(len(live) <= 1, 'competing live execution hold intents')
        return rows, live

    def receipt(self, intent):
        rows = [row for row in self.journal.records if row['event'] == 'hold-published'
                and row['intent'] == intent['sequence']]
        require(len(rows) <= 1, 'competing execution hold receipts')
        return rows[0]['receipt'] if rows else None

    def _published(self, intent, receipt, adopted=False):
        self.validate()
        value = intent['hold']
        require(receipt['marker'] == {'window': value['window'], 'reason': value['reason']}
                and receipt == self.gate._hold_receipt(), 'published execution hold receipt differs')
        self.journal.append('hold-published', intent=intent['sequence'], receipt=receipt,
                            adopted_for_restoration=adopted)

    def _fields(self, protective):
        return {'hold': {'baseline': self.baseline, 'window': 'hold-' + secrets.token_hex(32),
                         'reason': REASON, 'protective': protective}}

    def check_forward(self):
        self.validate()
        require(not self.restore_only, 'restored execution hold cannot certify forward work')
        if self._closing and self.guard is None:
            require(self.gate.marker() is None, 'forward close requires an open gate')
            return None
        require(self.guard is not None, 'forward work requires the original closed observer')
        evidence = self.guard.check()
        require(evidence.get('verified') is True and evidence.get('restoration_only') is False
                and evidence.get('kernel_file_watch') is True
                and evidence.get('path_watch', {}).get('kernel_path_watch') is True
                and evidence.get('watch_session_id') == self.original_session,
                'forward work requires the original native closed observer')
        return evidence

    def close_and_drain(self):
        require(self.guard is None and not self.intents()[0], 'execution hold was already attempted')
        fields = self._fields(False)
        def apply():
            intent = self.intents()[1][0]
            self.guard = self.gate.close_and_drain(fields['hold']['window'], REASON, self.seconds,
                on_publication=lambda receipt: self._published(intent, receipt))
            self.original_session = self.guard.check()['watch_session_id']
        self._closing = True
        try:
            return self.journal.mutate(ANCHOR, 'close-execution-hold', apply, self.check_forward,
                                       intent_fields=fields, hold=self)
        finally:
            self._closing = False

    def mutate(self, unit, action, apply, verify, failure_evidence=None):
        self.check_forward()
        def checked():
            evidence = verify()
            require(isinstance(evidence, dict) and evidence.get('verified') is True,
                    'mutation lacks verified evidence')
            return {**evidence, 'execution_hold': self.check_forward()}
        return self.journal.mutate(unit, action, apply, checked,
                                   failure_evidence=failure_evidence, hold=self)

    def readiness(self, observe, final_check):
        services = {}
        for unit, prior in self.journal.prior.items():
            actual = observe(unit, prior)
            require(isinstance(actual, dict) and all(isinstance(actual.get(key), bool)
                    for key in ('loaded', 'running', 'disabled')) and actual.get('identity') == prior['identity']
                    and matches(actual, prior) and actual.get('verified') is True,
                    'complete baseline service readiness was not verified: ' + unit)
            services[unit] = actual
        physical = final_check()
        require(isinstance(physical, dict) and physical.get('verified') is True,
                'final physical readiness was not verified')
        return {'services': services, 'physical': physical, 'baseline_sha256': self.baseline}

    def _protect(self, live):
        if live:
            self.journal.append('hold-superseded', intent=live[0]['sequence'],
                                reason='interrupted hold unexpectedly open')
        fields = self._fields(True)
        intent = self.journal.append('intent', unit=ANCHOR, action='protective-execution-hold', **fields)
        self.guard = self.gate.close_for_restoration(fields['hold']['window'], REASON, self.seconds,
            on_publication=lambda receipt: self._published(intent, receipt))
        self.journal.append('hold-restoration-drained', intent=intent['sequence'], evidence=self.guard.check())

    def prepare(self, observe, final_check):
        self.validate()
        rows, live = self.intents()
        if (not self.journal.reopened and self.journal.boot == self.journal.records[0]['boot']
                and self.guard is not None and not self.restore_only and not self.journal.write_failed
                and not any(row['event'] == 'failed' for row in self.journal.records)):
            self.check_forward()
            return
        self.restore_only = True
        self.journal.append('failed', unit=ANCHOR, action='interrupted-execution-hold',
                            reason='lost interval cannot certify copies')
        self.close()
        marker = self.gate.marker()
        if marker is not None:
            require(len(live) == 1 and marker ==
                    {k: live[0]['hold'][k] for k in ('window', 'reason')},
                    'closed execution hold has no unique matching durable intent')
            receipt = self.receipt(live[0])
            if receipt is None:
                receipt = self.gate._hold_receipt()
                self._published(live[0], receipt, adopted=True)
            self.guard = self.gate.reattach(receipt, self.seconds)
            self.journal.append('hold-restoration-drained', intent=live[0]['sequence'], evidence=self.guard.check())
            return
        prior_publication = any(row['event'] == 'hold-published' for row in self.journal.records)
        protective = any(row['hold']['protective'] for row in rows)
        if not prior_publication and not protective:
            try:
                evidence = self.readiness(observe, final_check)
            except Exception:
                evidence = None
            if evidence is not None:
                self.journal.append('hold-ambiguous-open-ready', evidence=evidence,
                                    history_certified=False)
                return
        self._protect(live)

    def check_closed(self):
        self.validate()
        require(self.guard is not None, 'dependency restoration requires a drained closed hold')
        return self.guard.check() if self.restore_only else self.check_forward()

    def before_restore(self):
        self.validate()
        if self.gate.marker() is None:
            self.journal.append('failed', unit=ANCHOR, action='restoration-needs-protective-hold',
                                reason='open gate cannot bracket dependency mutation')
            self.restore_only = True
            self.close()
            self._protect(self.intents()[1])
        self.check_closed()

    def complete(self, observe, final_check):
        self.validate()
        evidence = self.readiness(observe, final_check)
        self.journal.append('hold-reopen-ready', evidence=evidence)
        _, live = self.intents()
        if self.gate.marker() is None:
            require(self.restore_only and self.guard is None, 'execution hold disappeared before reopen')
            if live:
                self.journal.append('hold-superseded', intent=live[0]['sequence'],
                                    reason='ambiguous open baseline fully restored')
        else:
            require(len(live) == 1 and self.guard is not None, 'execution hold observer is absent')
            if self.restore_only:
                held = self.guard.check()
                require(held.get('restoration_only') is True and 'verified' not in held
                        and 'watch_session_id' not in held, 'recovery cannot regain a certifying observer')
            else:
                self.check_forward()
            intent = live[0]
            self.journal.append('hold-reopen-intent', intent=intent['sequence'], receipt=self.guard.receipt)
            def ready():
                self.validate()
                self.guard.check()
                result = self.fast_check()
                require(isinstance(result, dict) and result.get('verified') is True
                        and result.get('baseline_sha256') == self.baseline,
                        'fast final baseline readiness was not verified')
                return result
            self.gate.reopen(self.guard.receipt, self.seconds, before_open=ready)
            self.journal.append('hold-opened', intent=intent['sequence'], baseline_sha256=self.baseline,
                                restored_only=self.restore_only)
        return {'verified': True, 'baseline_sha256': self.baseline, 'gate_open': True,
                'restored_only': self.restore_only, 'history_certified': not self.restore_only}

    def recover(self, restore, observe, final_check, diagnostics=None):
        return self.journal.recover(restore, observe, final_check, diagnostics, hold=self)

    def close(self):
        if self.guard is not None:
            self.guard.close()
            self.guard = None
