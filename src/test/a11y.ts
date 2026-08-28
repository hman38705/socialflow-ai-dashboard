/**
 * Automated accessibility assertions for Vitest component tests.
 * See docs/accessibility.md for the audit this backs (FE-122).
 *
 * Usage:
 *   import { expectNoA11yViolations } from '@/test/a11y';
 *   const { container } = render(<SomePage />);
 *   await expectNoA11yViolations(container);
 */
import axe, { type ImpactValue, type Result } from 'axe-core';

const FAILING_IMPACTS: ImpactValue[] = ['serious', 'critical'];

export interface A11yCheckOptions {
  /** Impact levels that fail the assertion. Defaults to ['serious', 'critical']. */
  failingImpacts?: ImpactValue[];
}

function describeViolation(violation: Result): string {
  const nodes = violation.nodes.map((n) => `    - ${n.target.join(' ')}`).join('\n');
  return `[${violation.impact ?? 'unknown'}] ${violation.id}: ${violation.help}\n${nodes}`;
}

/**
 * Runs axe-core against a rendered DOM node and throws with a readable report
 * if any violation at or above the failing impact levels is found. Violations
 * below that threshold are logged (not thrown) so they stay visible without
 * blocking CI.
 */
export async function expectNoA11yViolations(
  container: Element | Document,
  options: A11yCheckOptions = {},
): Promise<void> {
  const failingImpacts = options.failingImpacts ?? FAILING_IMPACTS;
  const results = await axe.run(container);

  const failures = results.violations.filter(
    (v) => v.impact && failingImpacts.includes(v.impact),
  );
  const warnings = results.violations.filter(
    (v) => !v.impact || !failingImpacts.includes(v.impact),
  );

  if (warnings.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(
      `[a11y] ${warnings.length} sub-threshold violation(s):\n${warnings
        .map(describeViolation)
        .join('\n')}`,
    );
  }

  if (failures.length > 0) {
    throw new Error(
      `[a11y] ${failures.length} violation(s) at or above [${failingImpacts.join(', ')}]:\n${failures
        .map(describeViolation)
        .join('\n')}`,
    );
  }
}
