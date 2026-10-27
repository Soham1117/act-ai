export const notificationTemplateMessages: Record<string, { en: string; es: string }> = {
  "notificationTemplates.note": {
    en: " Note: {note}",
    es: " Nota: {note}",
  },
  "notificationTemplates.updated": {
    en: "updated",
    es: "actualizado",
  },
  "notificationTemplates.entered": {
    en: "entered",
    es: "registrado",
  },
  "notificationTemplates.requestStatus.title": {
    en: "Request {status}",
    es: "Solicitud {status}",
  },
  "notificationTemplates.requestStatus.message": {
    en: 'Your request "{title}" is {status}.{note}',
    es: 'Tu solicitud "{title}" está {status}.{note}',
  },
  "notificationTemplates.leaveDecision.title": {
    en: "Leave {status}",
    es: "Permiso {status}",
  },
  "notificationTemplates.leaveDecision.message": {
    en: "Your {leaveType} leave ({startDate} to {endDate}, {days} days) is {status}.{note}",
    es: "Tu permiso de {leaveType} ({startDate} a {endDate}, {days} días) está {status}.{note}",
  },
  "notificationTemplates.leaveCancelled.title": {
    en: "Leave cancelled by an admin",
    es: "Permiso cancelado por un administrador",
  },
  "notificationTemplates.leaveCancelled.message": {
    en: "Your {leaveType} leave ({startDate} to {endDate}) was cancelled.{note}",
    es: "Tu permiso de {leaveType} ({startDate} a {endDate}) fue cancelado.{note}",
  },
  "notificationTemplates.leaveAdjusted.title": {
    en: "Leave balance adjusted",
    es: "Saldo de permisos ajustado",
  },
  "notificationTemplates.leaveAdjusted.message": {
    en: "Your {leaveType} leave balance for {year} changed by {days} days.{note}",
    es: "Tu saldo de permisos de {leaveType} para {year} cambió en {days} días.{note}",
  },
  "notificationTemplates.reimbursementStatus.title": {
    en: "Reimbursement {status}",
    es: "Reembolso {status}",
  },
  "notificationTemplates.reimbursementStatus.message": {
    en: 'Your claim "{title}" is {status}.{note}',
    es: 'Tu reclamo "{title}" está {status}.{note}',
  },
  "notificationTemplates.reimbursementPaid.title": {
    en: "Reimbursement paid",
    es: "Reembolso pagado",
  },
  "notificationTemplates.reimbursementPaid.message": {
    en: 'Your claim "{title}" was paid ({amount}).{note}',
    es: 'Tu reclamo "{title}" fue pagado ({amount}).{note}',
  },
  "notificationTemplates.reimbursementReopened.title": {
    en: "Reimbursement reopened",
    es: "Reclamo de reembolso reabierto",
  },
  "notificationTemplates.reimbursementReopened.message": {
    en: 'Your rejected claim "{title}" was reopened for review.',
    es: 'Tu reclamo rechazado "{title}" se reabrió para revisión.',
  },
  "notificationTemplates.documentAvailable.title": {
    en: "New document available",
    es: "Nuevo documento disponible",
  },
  "notificationTemplates.documentAvailable.message": {
    en: 'A new document "{title}" was added to your documents.',
    es: 'Se agregó un nuevo documento, "{title}", a tus documentos.',
  },
  "notificationTemplates.payrollAvailable.title": {
    en: "New pay document available",
    es: "Nuevo documento de nómina disponible",
  },
  "notificationTemplates.payrollAvailable.message": {
    en: "A new {category} document for the pay period ending {payPeriodEnd} is available in Payroll.",
    es: "Hay un nuevo documento de {category} para el período de nómina que termina el {payPeriodEnd} en Nómina.",
  },
  "notificationTemplates.employmentEnded.title": {
    en: "Your employment has ended",
    es: "Tu relación laboral terminó",
  },
  "notificationTemplates.employmentEnded.message": {
    en: "Your account is read-only until {endDate} so you can view pay stubs and documents. After that you cannot sign in.",
    es: "Tu cuenta será de solo lectura hasta {endDate} para que puedas consultar tus recibos de nómina y documentos. Después, no podrás iniciar sesión.",
  },
  "notificationTemplates.accountReactivated.title": {
    en: "Your account was reactivated",
    es: "Tu cuenta fue reactivada",
  },
  "notificationTemplates.accountReactivated.message": {
    en: "Your account has full access again.",
    es: "Tu cuenta vuelve a tener acceso completo.",
  },
  "notificationTemplates.accountApproved.title": {
    en: "Your account was approved",
    es: "Tu cuenta fue aprobada",
  },
  "notificationTemplates.accountApproved.message": {
    en: "Welcome aboard. Your account is now fully active.",
    es: "Te damos la bienvenida. Tu cuenta ya está activa por completo.",
  },
  "notificationTemplates.roleAdmin.title": {
    en: "You are now an admin",
    es: "Ahora eres administrador",
  },
  "notificationTemplates.roleAdmin.message": {
    en: "Sign in again for the change to take effect.",
    es: "Inicia sesión de nuevo para que el cambio surta efecto.",
  },
  "notificationTemplates.roleEmployee.title": {
    en: "Your admin access was removed",
    es: "Se eliminó tu acceso de administrador",
  },
  "notificationTemplates.roleEmployee.message": {
    en: "Sign in again for the change to take effect.",
    es: "Inicia sesión de nuevo para que el cambio surta efecto.",
  },
  "notificationTemplates.shiftAutoClosed.title": {
    en: "A previous shift was left open",
    es: "Un turno anterior quedó abierto",
  },
  "notificationTemplates.shiftAutoClosed.message": {
    en: "Your earlier shift ran past {hours} hours and was closed automatically. An admin will review the hours.",
    es: "Tu turno anterior superó las {hours} horas y se cerró automáticamente. Un administrador revisará las horas.",
  },
  "notificationTemplates.benefitsWaived.title": {
    en: "Benefits updated",
    es: "Beneficios actualizados",
  },
  "notificationTemplates.benefitsWaived.message": {
    en: "Your waiver of {plan} was recorded.",
    es: "Se registró tu rechazo de {plan}.",
  },
  "notificationTemplates.benefitsEnrollment.title": {
    en: "Benefits updated",
    es: "Beneficios actualizados",
  },
  "notificationTemplates.benefitsEnrollment.message": {
    en: "Your {plan} enrollment was {change} ({status}).",
    es: "Tu inscripción en {plan} fue {change} ({status}).",
  },
  "notificationTemplates.benefitsConfirmed.title": {
    en: "Enrollment confirmed",
    es: "Inscripción confirmada",
  },
  "notificationTemplates.benefitsConfirmed.message": {
    en: "Your {plan} enrollment is confirmed, effective {effectiveDate}.",
    es: "Tu inscripción en {plan} está confirmada y entra en vigor el {effectiveDate}.",
  },
  "notificationTemplates.benefitsTier.title": {
    en: "Benefits tier changed",
    es: "Nivel de beneficios cambiado",
  },
  "notificationTemplates.benefitsTier.message": {
    en: "Your {plan} coverage changes to {tier} effective {effectiveDate}.",
    es: "Tu cobertura de {plan} cambia al nivel {tier} a partir del {effectiveDate}.",
  },
  "notificationTemplates.benefitsEnding.title": {
    en: "Benefits coverage ending",
    es: "Fin de la cobertura de beneficios",
  },
  "notificationTemplates.benefitsEnding.message": {
    en: "Your {plan} coverage ends {endDate}.",
    es: "Tu cobertura de {plan} termina el {endDate}.",
  },
  "notificationTemplates.retirementChanged.title": {
    en: "Benefits updated",
    es: "Beneficios actualizados",
  },
  "notificationTemplates.retirementChanged.message": {
    en: "Your {plan} 401(k) election was {change}.",
    es: "Tu elección de 401(k) para {plan} fue {change}.",
  },
  "notificationTemplates.retirementConfirmed.title": {
    en: "Retirement election confirmed",
    es: "Elección de jubilación confirmada",
  },
  "notificationTemplates.retirementConfirmed.message": {
    en: "Your {plan} 401(k) election is confirmed, effective {effectiveDate}.",
    es: "Tu elección de 401(k) para {plan} está confirmada y entra en vigor el {effectiveDate}.",
  },
  "notificationTemplates.retirementEnding.title": {
    en: "Retirement deferral ending",
    es: "Fin de las aportaciones para la jubilación",
  },
  "notificationTemplates.retirementEnding.message": {
    en: "Your {plan} 401(k) deferral stops {endDate}.",
    es: "Tus aportaciones al 401(k) de {plan} se suspenden el {endDate}.",
  },
  "notificationTemplates.benefitsRenewed.title": {
    en: "Benefits renewed",
    es: "Beneficios renovados",
  },
  "notificationTemplates.benefitsRenewed.message": {
    en: "Your {plan} coverage was renewed for the plan year starting {startDate}.",
    es: "Tu cobertura de {plan} se renovó para el año del plan que comienza el {startDate}.",
  },
};
