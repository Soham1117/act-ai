import { LEAVE_TYPES, type YearBalances } from "@/lib/leave-balance";

/** Per-type balance table, fed by the shared leave-balance loader. */
export function LeaveBalanceSummary({ balances }: { balances: YearBalances | null }) {
  if (!balances) {
    return <p className="mb-3 text-xs text-muted-foreground">Balance unavailable right now.</p>;
  }
  const rows = LEAVE_TYPES.map((t) => balances.types[t]!).filter(
    (b) => b.unlimited || b.allowed > 0 || b.used > 0,
  );
  return (
    <div className="mb-4 overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-left text-[10px] uppercase tracking-wider text-muted-foreground">
            <th className="py-1 pr-3">{balances.year}</th>
            <th className="py-1 pr-3 text-right">Allowed</th>
            <th className="py-1 pr-3 text-right">Taken</th>
            <th className="py-1 pr-3 text-right">Upcoming</th>
            <th className="py-1 pr-3 text-right">Pending</th>
            <th className="py-1 text-right">Remaining</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((b) => (
            <tr key={b.leaveType}>
              <td className="py-1 pr-3 font-medium">{b.leaveType}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums">{b.unlimited ? "∞" : b.allowed}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums">{b.taken}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums">{b.upcoming}</td>
              <td className="py-1 pr-3 text-right font-mono tabular-nums">{b.pending}</td>
              <td className="py-1 text-right font-mono font-semibold tabular-nums">
                {b.unlimited ? "Unlimited" : b.available}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
