import { Download, Eye, Paperclip } from "lucide-react";

/** View / download links for a claim's receipts (served by the authenticated receipt route). */
export function ReceiptLinks({
  receipts,
}: {
  receipts: { id: string; originalName: string }[];
}) {
  if (receipts.length === 0) {
    return <span className="text-[11px] text-muted-foreground">No receipts attached</span>;
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1">
      {receipts.map((r) => (
        <li key={r.id} className="flex items-center gap-1.5 text-[11px]">
          <Paperclip className="h-3 w-3 text-muted-foreground" />
          <span className="max-w-[180px] truncate" title={r.originalName}>{r.originalName}</span>
          <a
            href={`/api/reimbursements/receipts/${r.id}/file`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:underline"
            aria-label={`View ${r.originalName}`}
          >
            <Eye className="inline h-3 w-3" />
          </a>
          <a
            href={`/api/reimbursements/receipts/${r.id}/file?download=1`}
            className="text-primary hover:underline"
            aria-label={`Download ${r.originalName}`}
          >
            <Download className="inline h-3 w-3" />
          </a>
        </li>
      ))}
    </ul>
  );
}
