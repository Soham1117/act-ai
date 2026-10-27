export const workspaceMessages: Record<string, { en: string; es: string }> = {
  "workspace.noEmployee": {
    en: "No employee record.",
    es: "No hay un registro de empleado.",
  },
  "workspace.cancel": { en: "Cancel", es: "Cancelar" },
  "workspace.submit": { en: "Submit", es: "Enviar" },
  "workspace.other": { en: "Other", es: "Otro" },
  "workspace.requests.title": { en: "Requests", es: "Solicitudes" },
  "workspace.requests.description": {
    en: "Submit requests for documents, equipment, training, schedule changes, and more.",
    es: "Envía solicitudes de documentos, equipo, capacitación, cambios de horario y más.",
  },
  "workspace.requests.mine": {
    en: "My requests ({count})",
    es: "Mis solicitudes ({count})",
  },
  "workspace.requests.empty": {
    en: "No requests yet.",
    es: "Todavía no tienes solicitudes.",
  },
  "workspace.requests.adminNote": { en: "Admin note:", es: "Nota del administrador:" },
  "workspace.requests.submitted": { en: "Submitted {time}", es: "Enviada {time}" },
  "workspace.requests.history": {
    en: "Status history ({count})",
    es: "Historial de estados ({count})",
  },
  "workspace.requests.new": { en: "New request", es: "Nueva solicitud" },
  "workspace.requests.type": { en: "Type", es: "Tipo" },
  "workspace.requests.leaveHelpBefore": {
    en: "Request time off on the",
    es: "Solicita tiempo libre en la",
  },
  "workspace.requests.leavePage": { en: "Leave page", es: "página de permisos" },
  "workspace.requests.leaveHelpAfter": {
    en: ", where your balance and dates are checked automatically. This form can't create a leave request.",
    es: ", donde se verifican automáticamente tu saldo y las fechas. Este formulario no puede crear una solicitud de permiso.",
  },
  "workspace.requests.subject": { en: "Subject", es: "Asunto" },
  "workspace.requests.subjectPlaceholder": {
    en: "Enter a subject",
    es: "Escribe un asunto",
  },
  "workspace.requests.details": { en: "Details", es: "Detalles" },
  "workspace.requests.detailsPlaceholder": {
    en: "Describe your request",
    es: "Describe tu solicitud",
  },
  "workspace.requests.submittedToast": {
    en: "Request submitted",
    es: "Solicitud enviada",
  },
  "workspace.requests.withdrawConfirm": {
    en: "Withdraw this request?",
    es: "¿Quieres retirar esta solicitud?",
  },
  "workspace.requests.withdrawnToast": {
    en: "Request withdrawn",
    es: "Solicitud retirada",
  },
  "workspace.requests.withdraw": { en: "Withdraw", es: "Retirar" },
  "workspace.reimbursements.title": { en: "Reimbursements", es: "Reembolsos" },
  "workspace.reimbursements.description": {
    en: "Submit and track expense claims.",
    es: "Envía y consulta tus solicitudes de reembolso de gastos.",
  },
  "workspace.reimbursements.totalClaims": {
    en: "Total claims",
    es: "Total de solicitudes",
  },
  "workspace.reimbursements.pendingReview": {
    en: "Pending review",
    es: "Pendiente de revisión",
  },
  "workspace.reimbursements.approvedUnpaid": {
    en: "Approved, unpaid",
    es: "Aprobado, sin pagar",
  },
  "workspace.reimbursements.paidYear": { en: "Paid {year}", es: "Pagado en {year}" },
  "workspace.reimbursements.myClaims": { en: "My claims", es: "Mis solicitudes" },
  "workspace.reimbursements.empty": {
    en: "No claims yet.",
    es: "Todavía no tienes solicitudes.",
  },
  "workspace.reimbursements.paidAmount": { en: "Paid {amount}", es: "Pagado: {amount}" },
  "workspace.reimbursements.rejectionReason": {
    en: "Rejection reason:",
    es: "Motivo del rechazo:",
  },
  "workspace.reimbursements.reviewerNote": {
    en: "Note from reviewer:",
    es: "Nota del revisor:",
  },
  "workspace.reimbursements.history": {
    en: "History ({count})",
    es: "Historial ({count})",
  },
  "workspace.reimbursements.newClaim": {
    en: "New reimbursement claim",
    es: "Nueva solicitud de reembolso",
  },
  "workspace.reimbursements.titleLabel": { en: "Title", es: "Título" },
  "workspace.reimbursements.titlePlaceholder": {
    en: "Enter a title",
    es: "Escribe un título",
  },
  "workspace.reimbursements.category": { en: "Category", es: "Categoría" },
  "workspace.reimbursements.amountUsd": { en: "Amount (USD)", es: "Importe (USD)" },
  "workspace.reimbursements.amountPlaceholder": { en: "0.00", es: "0.00" },
  "workspace.reimbursements.expenseDate": { en: "Expense date", es: "Fecha del gasto" },
  "workspace.reimbursements.descriptionLabel": { en: "Description", es: "Descripción" },
  "workspace.reimbursements.descriptionPlaceholder": {
    en: "Describe the expense",
    es: "Describe el gasto",
  },
  "workspace.reimbursements.receiptsLabel": {
    en: "Receipts (optional, up to {count}; PDF, PNG, or JPG, 8 MB each)",
    es: "Comprobantes (opcional, hasta {count}; PDF, PNG o JPG, 8 MB cada uno)",
  },
  "workspace.reimbursements.removeReceipt": { en: "Remove {name}", es: "Quitar {name}" },
  "workspace.reimbursements.invalidReceiptType": {
    en: "{name}: receipts must be PDF, PNG, or JPG.",
    es: "{name}: los comprobantes deben ser PDF, PNG o JPG.",
  },
  "workspace.reimbursements.receiptTooLarge": {
    en: "{name} is larger than 8 MB.",
    es: "{name} supera los 8 MB.",
  },
  "workspace.reimbursements.maxReceipts": {
    en: "You can attach up to {count} receipts.",
    es: "Puedes adjuntar hasta {count} comprobantes.",
  },
  "workspace.reimbursements.amountPositive": {
    en: "Enter an amount greater than $0.00.",
    es: "Ingresa un importe mayor que $0.00.",
  },
  "workspace.reimbursements.amountOverLimit": {
    en: "Claims over ${amount} need to go through HR.",
    es: "Los gastos superiores a ${amount} deben tramitarse con Recursos Humanos.",
  },
  "workspace.reimbursements.submittedToast": {
    en: "Claim submitted",
    es: "Solicitud enviada",
  },
  "workspace.pagination.page": {
    en: "Page {page} of {totalPages}",
    es: "Página {page} de {totalPages}",
  },
  "workspace.pagination.previous": { en: "Previous", es: "Anterior" },
  "workspace.pagination.next": { en: "Next", es: "Siguiente" },
};
