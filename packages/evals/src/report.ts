import type { Diff } from './baseline.ts';
import type { RunResult } from './types.ts';

/**
 * Markdown for a pull request comment or a terminal.
 *
 * The deterministic and the sampled halves of the hallucination bar are
 * reported in separate blocks and never added together. A run with no human
 * reviewer has no semantic score at all — not a zero, not an estimate.
 * See ADR 0005.
 */

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export const reportRun = (result: RunResult): string => {
  const m = result.metrics;
  const lines: string[] = [];

  lines.push(`## Eval — ${result.suite} · ${result.tier}`);
  lines.push('');
  lines.push(
    `\`${result.chatModel}\` · \`${result.embeddingModel}\` · reranker \`${result.reranker}\` · ${result.gitSha}`,
  );
  lines.push('');

  if (result.tier === 'provisional') {
    lines.push(
      '> **Provisional suite.** These cases were drafted from the storefront, not signed by the ' +
        'merchant. They prove the machinery works; they do not prove the answers match what this ' +
        "store's customers actually ask.",
    );
    lines.push('');
  }

  lines.push('### Enforced at runtime — a property of the system');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Fabricated literals | **${m.hallucinationCount}** |`);
  lines.push(`| Uncited policy claims | **${m.citationMissCount}** |`);
  lines.push(`| Replies withheld that should have been sent | ${m.falseSuppressionCount} |`);
  lines.push('');
  lines.push('### Measured');
  lines.push('');
  lines.push('| | |');
  lines.push('| --- | --- |');
  lines.push(`| Cases | ${m.cases} (${m.passed} passed, ${m.failed} failed) |`);
  // Both figures, always, in the same table. A reader who sees one without the
  // other cannot tell whether the number moved because the system improved or
  // because an expectation was rewritten.
  lines.push(`| Accuracy, as originally scored | **${pct(m.accuracyAsOriginallyScored)}** |`);
  lines.push(
    `| Accuracy, after adjudication | ${pct(m.accuracy)}${m.adjudicatedCases > 0 ? ` · ${m.adjudicatedCases} case(s) reclassified` : ' · no reclassifications'} |`,
  );
  lines.push(`| Deflection | ${pct(m.deflectionRate)} |`);
  lines.push(`| Escalation precision | ${pct(m.escalationPrecision)} |`);
  lines.push(`| Retrieval hit rate | ${pct(m.retrievalHitRate)} |`);
  lines.push(`| p95 latency | ${m.p95LatencyMs} ms |`);
  lines.push(
    `| Cost per conversation | ${m.costPerConversationUsd === null ? 'unpriced' : `$${m.costPerConversationUsd.toFixed(5)}`} |`,
  );
  lines.push('');
  lines.push('### Not scored here');
  lines.push('');
  lines.push(
    'Semantic policy accuracy — whether a cited claim is a faithful reading of its source — is a ' +
      'sampled human review. No automated number is produced for it, because an LLM judging a ' +
      'paraphrase is the same class of system that produced it.',
  );
  lines.push('');

  lines.push(`### Ship bar: ${result.meetsShipBar ? '**pass**' : '**fail**'}`);
  lines.push('');
  for (const note of result.shipBarNotes) lines.push(`- ${note}`);
  if (result.shipBarNotes.length === 0) lines.push('- all gates passed');
  lines.push('');

  const failed = result.outcomes.filter((o) => !o.passed);
  if (failed.length > 0) {
    lines.push('<details><summary>Failing cases</summary>');
    lines.push('');
    for (const outcome of failed) {
      lines.push(`**${outcome.id}** · ${outcome.category} · ${outcome.lang}`);
      for (const failure of outcome.failures) lines.push(`- ${failure}`);
      if (outcome.reply) lines.push(`  > ${outcome.reply.replace(/\n/g, ' ').slice(0, 240)}`);
      lines.push('');
    }
    lines.push('</details>');
  }
  return lines.join('\n');
};

export const reportDiff = (diff: Diff): string => {
  const lines: string[] = [];
  lines.push(`## Model diff — \`${diff.baseline.chatModel}\` → \`${diff.candidate.chatModel}\``);
  lines.push('');
  lines.push(`baseline ${diff.baseline.gitSha} (${diff.baseline.recordedAt.slice(0, 16)}Z)`);
  lines.push('');

  lines.push('### Cases that changed');
  lines.push('');
  if (diff.flips.length === 0) {
    lines.push('None. Every case behaved the same way on both models.');
  } else {
    lines.push('| case | | was | now | why |');
    lines.push('| --- | --- | --- | --- | --- |');
    for (const flip of diff.flips) {
      const mark = { fixed: '✅ fixed', broken: '❌ broken', new: '➕ new', removed: '➖ removed' }[
        flip.direction
      ];
      lines.push(
        `| \`${flip.id}\` | ${mark} | ${flip.was} | ${flip.now} | ${flip.failures[0] ?? ''} |`,
      );
    }
  }
  lines.push('');

  lines.push('### Citation-gate suppressions');
  lines.push('');
  if (diff.suppressions.length === 0) {
    lines.push('No change.');
  } else {
    for (const change of diff.suppressions) {
      const note = change.wasCorrectAnswer ? ' — **this withheld a correct answer**' : '';
      lines.push(`- \`${change.id}\` suppression ${change.change}${note}`);
    }
    lines.push('');
    lines.push(
      '**Every suppression that appeared needs reading before this swap is accepted.** A gate that ' +
        'starts withholding correct answers on a new model looks identical in the totals to one that ' +
        'started catching real fabrications.',
    );
  }
  lines.push('');

  lines.push('### Deterministic counts');
  lines.push('');
  lines.push(
    `- fabricated literals: ${diff.hallucinationDelta >= 0 ? '+' : ''}${diff.hallucinationDelta}`,
  );
  lines.push(
    `- uncited policy claims: ${diff.citationMissDelta >= 0 ? '+' : ''}${diff.citationMissDelta}`,
  );
  lines.push('');

  lines.push(
    '<details><summary>Metric deltas (orientation only — the flips above are the signal)</summary>',
  );
  lines.push('');
  for (const [key, delta] of Object.entries(diff.metricDeltas)) {
    if (delta !== 0) lines.push(`- ${key}: ${delta >= 0 ? '+' : ''}${delta}`);
  }
  lines.push('');
  lines.push('</details>');
  return lines.join('\n');
};
