/**
 * A monthly bandwidth allowance for the relays.
 *
 * Commercial hosts meter egress, so "how much may the server send this month" is a
 * budget, not a rate. It counts bytes handed to clients -- the direction that is
 * billed -- and it rolls over by itself when the calendar month changes, so nobody has
 * to remember to reset it.
 *
 * `monthlyBytes = 0` means no budget: an operator who never set the value keeps the
 * behaviour it had before this existed.
 */
export function monthStamp(at = Date.now()) {
  return new Date(at).toISOString().slice(0, 7);
}

export function createEgressBudget({ now = () => Date.now(), monthlyBytes = 0 } = {}) {
  const budgetBytes = Math.max(0, Number(monthlyBytes) || 0);
  let state = { month: monthStamp(now()), bytes: 0 };

  const roll = () => {
    const month = monthStamp(now());
    if (state.month !== month) state = { month, bytes: 0 };
  };

  return {
    get monthlyBytes() {
      return budgetBytes;
    },

    add(bytes) {
      roll();
      const value = Math.max(0, Number(bytes) || 0);
      if (value) state.bytes += value;
    },

    used() {
      roll();
      return state.bytes;
    },

    remaining() {
      roll();
      return budgetBytes > 0 ? Math.max(0, budgetBytes - state.bytes) : 0;
    },

    exhausted() {
      roll();
      return budgetBytes > 0 && state.bytes >= budgetBytes;
    },

    /** Seconds until the allowance resets, for a Retry-After a client can trust. */
    retryAfterSeconds() {
      const current = new Date(now());
      const next = Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1, 0, 0, 0, 0);
      return Math.max(60, Math.round((next - current.getTime()) / 1000));
    },

    snapshot() {
      roll();
      return {
        monthlyEgressBytes: budgetBytes,
        egressUsedThisMonth: state.bytes,
        egressRemainingBytes: budgetBytes > 0 ? Math.max(0, budgetBytes - state.bytes) : 0
      };
    }
  };
}
