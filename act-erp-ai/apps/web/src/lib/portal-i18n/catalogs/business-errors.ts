export const businessErrorMessages: Record<string, { en: string; es: string }> = {
  "businessErrors.documents.upload": {
    en: "Check the file type and size, then try again.",
    es: "Revisa el archivo: debe ser PDF, PNG, JPG, DOCX, XLSX o TXT de hasta 15 MB y su contenido debe corresponder al formato. Inténtalo de nuevo.",
  },
  "businessErrors.leave.overlap": {
    en: "This overlaps your {status} {type} leave ({startDate} to {endDate}). Cancel that request first or choose different dates.",
    es: "Este intervalo se superpone con tu permiso {status} de tipo {type} ({startDate} a {endDate}). Cancela esa solicitud primero o elige otras fechas.",
  },
  "businessErrors.leave.overlapApproved": {
    en: "This overlaps already-approved {type} leave ({startDate} to {endDate}). Reject or adjust one of them.",
    es: "Este intervalo se superpone con un permiso de tipo {type} ya aprobado ({startDate} a {endDate}). Rechaza o ajusta una de las solicitudes.",
  },
  "businessErrors.leave.balanceShortfall": {
    en: "Not enough leave balance; pending requests are included. Reduce the requested days or adjust the employee's balance.",
    es: "No tienes suficientes días de permiso; las solicitudes pendientes también cuentan. Reduce los días solicitados o ajusta tu saldo.",
  },
  "businessErrors.leave.employeeInactive": {
    en: "Leave can only be requested for active employees.",
    es: "Solo se pueden solicitar permisos para empleados activos.",
  },
  "businessErrors.leave.employeeMissing": {
    en: "Your employee profile could not be found. Ask an admin to check your account, then try again.",
    es: "No se encontró tu perfil de empleado. Pídele a un administrador que revise tu cuenta e inténtalo de nuevo.",
  },
  "businessErrors.leave.requestMissing": {
    en: "That leave request no longer exists. Refresh the page and try again.",
    es: "Esa solicitud de permiso ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "businessErrors.leave.requestState": {
    en: "That request is already {status}. Refresh the page.",
    es: "La solicitud ya está {status}. Actualiza la página e inténtalo de nuevo.",
  },
  "businessErrors.leave.overdrawn": {
    en: "Approving would put the employee's {type} leave balance below zero for {years}. Adjust their balance first, or approve with the override option and a reason.",
    es: "Al aprobar, el saldo de permisos de {type} del empleado quedaría por debajo de cero en {years}. Ajusta su saldo primero o aprueba con la opción de excepción e indica el motivo.",
  },
  "businessErrors.leave.changed": {
    en: "That request was just changed by someone else. Refresh the page.",
    es: "Otra persona acaba de cambiar esa solicitud. Actualiza la página.",
  },
  "businessErrors.leave.notOwner": {
    en: "You can only cancel your own leave requests.",
    es: "Solo puedes cancelar tus propias solicitudes de permiso.",
  },
  "businessErrors.leave.started": {
    en: "Approved leave that has already started cannot be cancelled. Contact an admin if you need an adjustment.",
    es: "No se puede cancelar un permiso aprobado que ya comenzó. Comunícate con un administrador si necesitas un ajuste.",
  },
  "businessErrors.leave.cancelReason": {
    en: "Enter a reason for cancelling this leave. The employee will see it.",
    es: "Ingresa un motivo para cancelar este permiso. El empleado podrá verlo.",
  },
  "businessErrors.request.missing": {
    en: "That request no longer exists. Refresh the page.",
    es: "Esa solicitud ya no existe. Actualiza la página.",
  },
  "businessErrors.request.transition": {
    en: "A {from} request cannot be moved to {to}. Refresh the page.",
    es: "Una solicitud {from} no se puede cambiar al estado {to}. Actualiza la página e inténtalo de nuevo.",
  },
  "businessErrors.request.reopenState": {
    en: "Only completed or rejected requests can be reopened.",
    es: "Solo se pueden reabrir solicitudes completadas o rechazadas.",
  },
  "businessErrors.request.changed": {
    en: "That request was just changed by someone else. Refresh the page.",
    es: "Otra persona acaba de cambiar esa solicitud. Actualiza la página.",
  },
  "businessErrors.request.withdrawState": {
    en: "Only requests that haven't been picked up yet can be withdrawn. Contact an admin.",
    es: "Solo puedes retirar solicitudes que aún no se hayan comenzado a atender. Comunícate con un administrador.",
  },
  "businessErrors.request.updated": {
    en: "That request was just updated. Refresh the page.",
    es: "Otra persona acaba de actualizar esa solicitud. Actualiza la página.",
  },
  "businessErrors.reimbursement.amount": {
    en: "Enter an amount greater than $0.00, no more than ${limit}, with at most two decimal places. Claims above the limit must go through HR directly.",
    es: "Ingresa un monto mayor que $0.00, de hasta ${limit} y con un máximo de dos decimales. Los reclamos que superen el límite deben tramitarse directamente con Recursos Humanos.",
  },
  "businessErrors.reimbursement.paidAmount": {
    en: "The paid amount must be greater than $0.00 and no more than the claimed amount. Add a note if paying a partial amount.",
    es: "El monto pagado debe ser mayor que $0.00 y no puede superar el monto reclamado. Si el pago es parcial, agrega una nota explicativa.",
  },
  "businessErrors.reimbursement.receiptUpload": {
    en: "The receipt file {file} could not be validated. Attach a PDF, PNG, or JPG of up to 8 MB and make sure its contents match the file type.",
    es: "No se pudo validar el archivo de recibo {file}. Adjunta un PDF, PNG o JPG de hasta 8 MB y verifica que el contenido corresponda al formato.",
  },
  "businessErrors.onboarding.invalidFields": {
    en: "Check your details. Review the {field} field and correct it, then try again.",
    es: "Revisa tus datos y corrige el campo {field}. Verifica que la información cumpla con los requisitos e inténtalo de nuevo.",
  },
  "businessErrors.onboarding.invalidHireDate": {
    en: "Enter a valid hire date.",
    es: "Ingresa una fecha de contratación válida (año entre 1950 y dos años después del año actual).",
  },
  "businessErrors.onboarding.invalidBirthDate": {
    en: "Enter a valid date of birth.",
    es: "Ingresa una fecha de nacimiento válida, posterior a 1900 y anterior a hoy.",
  },
  "businessErrors.onboarding.duplicateAccount": {
    en: "That work email already has an account. Sign in instead, or use a different email.",
    es: "Ese correo laboral ya tiene una cuenta. Inicia sesión o usa otro correo.",
  },
  "businessErrors.onboarding.duplicateUsername": {
    en: "That username is already taken. Pick another.",
    es: "Ese nombre de usuario ya está en uso. Elige otro.",
  },
  "businessErrors.onboarding.documentLimit": {
    en: "Upload at most {count} documents.",
    es: "Puedes cargar un máximo de {count} documentos.",
  },
  "businessErrors.onboarding.documentUpload": {
    en: "Nothing was submitted. Fix these files and try again: {files}",
    es: "No se envió nada. Revisa los archivos indicados ({files}): cada documento debe ser PDF, PNG, JPG, DOCX, XLSX o TXT de hasta 15 MB, el total no debe superar 40 MB y el contenido debe corresponder al formato.",
  },
};
