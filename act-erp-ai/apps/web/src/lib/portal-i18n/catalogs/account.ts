export const accountMessages: Record<string, { en: string; es: string }> = {
  "account.settings.title": { en: "Settings", es: "Configuración" },
  "account.settings.description": {
    en: "Account, security, and appearance.",
    es: "Cuenta, seguridad y apariencia.",
  },
  "account.settings.readOnly": {
    en: "Your account is read-only, so this can't be changed right now.",
    es: "Tu cuenta es de solo lectura, así que no puedes cambiar esto ahora.",
  },
  "account.settings.account": { en: "Account", es: "Cuenta" },
  "account.settings.name": { en: "Name", es: "Nombre" },
  "account.settings.role": { en: "Role", es: "Rol" },
  "account.settings.employeeId": { en: "Employee ID", es: "ID de empleado" },
  "account.settings.usernameSignIn": {
    en: "Signs in with username",
    es: "Inicia sesión con nombre de usuario",
  },
  "account.settings.appearance": { en: "Appearance", es: "Apariencia" },
  "account.settings.appearanceDescription": {
    en: "Light / dark / system.",
    es: "Claro / oscuro / sistema.",
  },
  "account.settings.theme": { en: "Theme", es: "Tema" },
  "account.settings.themeDefault": {
    en: "Default is dark.",
    es: "El tema predeterminado es oscuro.",
  },
  "account.settings.password": { en: "Password", es: "Contraseña" },
  "account.settings.passwordDescription": {
    en: "Change your password. Requires the current one. You can do this even when your account is read-only.",
    es: "Cambia tu contraseña. Necesitas la contraseña actual. Puedes hacerlo aunque tu cuenta sea de solo lectura.",
  },
  "account.settings.kioskPin": { en: "Kiosk PIN", es: "PIN del quiosco" },
  "account.settings.temporaryPin": {
    en: "Your temporary PIN is {pin}. Change it here to a private 4-digit PIN.",
    es: "Tu PIN temporal es {pin}. Cámbialo aquí por un PIN privado de 4 dígitos.",
  },
  "account.settings.changeKioskPin": {
    en: "Change your kiosk PIN here. Use a private 4-digit PIN.",
    es: "Cambia aquí tu PIN del quiosco. Usa un PIN privado de 4 dígitos.",
  },
  "account.settings.twoFactor": {
    en: "Two-factor authentication",
    es: "Autenticación de dos factores",
  },
  "account.settings.twoFactorEnabled": {
    en: "A 6-digit code is emailed here every time you sign in.",
    es: "Cada vez que inicies sesión, recibirás aquí un código de 6 dígitos por correo electrónico.",
  },
  "account.settings.twoFactorPaused": {
    en: "Email verification is temporarily paused. Your saved address is optional.",
    es: "La verificación por correo electrónico está pausada temporalmente. Guardar una dirección es opcional.",
  },
  "account.settings.w2Delivery": { en: "W-2 delivery", es: "Entrega del formulario W-2" },
  "account.settings.benefitsDelivery": {
    en: "Benefits document delivery",
    es: "Entrega de documentos de beneficios",
  },
  "account.settings.paperDefaultOptIn": {
    en: "Paper by default, unless you opt in.",
    es: "La entrega es en papel de forma predeterminada, salvo que elijas la opción electrónica.",
  },
  "account.settings.privacyNotice": { en: "Privacy notice", es: "Aviso de privacidad" },
  "account.settings.privacyDescription": {
    en: " — what we collect and why.",
    es: " — qué recopilamos y por qué.",
  },
  "account.password.current": { en: "Current password", es: "Contraseña actual" },
  "account.password.new": { en: "New password", es: "Nueva contraseña" },
  "account.password.confirm": { en: "Confirm password", es: "Confirmar contraseña" },
  "account.password.mismatch": {
    en: "Passwords do not match",
    es: "Las contraseñas no coinciden",
  },
  "account.password.tooShort": { en: "Min 8 characters", es: "Mínimo 8 caracteres" },
  "account.password.updated": {
    en: "Password updated — please sign in again",
    es: "Contraseña actualizada — inicia sesión de nuevo",
  },
  "account.password.update": { en: "Update password", es: "Actualizar contraseña" },
  "account.kioskPin.invalid": {
    en: "PIN must be exactly 4 digits.",
    es: "El PIN debe tener exactamente 4 dígitos.",
  },
  "account.kioskPin.mismatch": { en: "PINs do not match.", es: "Los PIN no coinciden." },
  "account.kioskPin.updated": { en: "Kiosk PIN set", es: "PIN del quiosco configurado" },
  "account.kioskPin.new": { en: "New PIN (4 digits)", es: "Nuevo PIN (4 dígitos)" },
  "account.kioskPin.confirm": { en: "Confirm PIN", es: "Confirmar PIN" },
  "account.kioskPin.set": { en: "Set PIN", es: "Configurar PIN" },
  "account.personalEmail.updated": {
    en: "Personal email updated",
    es: "Correo electrónico personal actualizado",
  },
  "account.personalEmail.label": {
    en: "Personal email",
    es: "Correo electrónico personal",
  },
  "account.personalEmail.labelRequired": {
    en: "Personal email",
    es: "Correo electrónico personal",
  },
  "account.personalEmail.labelOptional": {
    en: "Personal email (optional)",
    es: "Correo electrónico personal (opcional)",
  },
  "account.personalEmail.placeholder": {
    en: "name@example.com",
    es: "nombre@ejemplo.com",
  },
  "account.personalEmail.update": { en: "Update", es: "Actualizar" },
  "account.consent.enabledBadge": {
    en: "Consented — electronic delivery on",
    es: "Consentimiento otorgado — entrega electrónica activada",
  },
  "account.consent.withdrawing": {
    en: "Withdrawing consent…",
    es: "Retirando el consentimiento…",
  },
  "account.consent.withdrawToPaper": {
    en: "Withdraw consent — go back to paper",
    es: "Retirar el consentimiento — volver a la entrega en papel",
  },
  "account.consent.saving": { en: "Saving consent…", es: "Guardando el consentimiento…" },
  "account.w2.enabled": {
    en: "Electronic W-2 delivery enabled",
    es: "Entrega electrónica del W-2 activada",
  },
  "account.w2.withdrawn": {
    en: "Reverted to paper W-2 delivery",
    es: "Se restableció la entrega del W-2 en papel",
  },
  "account.w2.enabledDescription": {
    en: "Your W-2 will be delivered through this system instead of on paper. You can withdraw this at any time — a withdrawal takes effect immediately and does not affect any W-2 already provided.",
    es: "Tu W-2 se entregará a través de este sistema en lugar de en papel. Puedes retirar tu consentimiento en cualquier momento; el retiro entra en vigor de inmediato y no afecta ningún W-2 que ya se haya entregado.",
  },
  "account.w2.defaultDescription": {
    en: "By default, your W-2 (annual tax statement) is delivered on paper, as required by federal law. You can instead choose to receive it electronically through this system.",
    es: "De forma predeterminada, tu W-2 (declaración anual de impuestos) se entrega en papel, según lo exige la ley federal. Puedes elegir recibirlo electrónicamente a través de este sistema.",
  },
  "account.w2.consentDescription": {
    en: "If you consent: you confirm you can access documents through this site (you're doing so right now) and are able to print or save your W-2 for your records. You may withdraw consent at any time in this Settings page — after withdrawing, your next W-2 will be delivered on paper. If you don't consent, or if your employment ends, you'll receive your W-2 on paper regardless.",
    es: "Al otorgar tu consentimiento, confirmas que puedes acceder a documentos en este sitio (lo estás haciendo ahora) y que puedes imprimir o guardar tu W-2 para tus archivos. Puedes retirar tu consentimiento en cualquier momento desde esta página de Configuración; después del retiro, tu próximo W-2 se entregará en papel. Si no otorgas tu consentimiento o termina tu empleo, recibirás tu W-2 en papel de todos modos.",
  },
  "account.w2.giveConsent": {
    en: "I consent to electronic W-2 delivery",
    es: "Doy mi consentimiento para recibir el W-2 electrónicamente",
  },
  "account.benefits.enabled": {
    en: "Electronic benefits document delivery enabled",
    es: "Entrega electrónica de documentos de beneficios activada",
  },
  "account.benefits.withdrawn": {
    en: "Reverted to paper delivery for benefits documents",
    es: "Se restableció la entrega en papel de documentos de beneficios",
  },
  "account.benefits.enabledDescription": {
    en: "Health & welfare plan documents (SPDs, summaries of material modifications, benefit summaries) can be delivered through this system instead of on paper. You can withdraw this at any time — a withdrawal takes effect immediately.",
    es: "Los documentos del plan de salud y bienestar (SPD, resúmenes de modificaciones sustanciales y resúmenes de beneficios) pueden entregarse a través de este sistema en lugar de en papel. Puedes retirar tu consentimiento en cualquier momento; el retiro entra en vigor de inmediato.",
  },
  "account.benefits.defaultDescription": {
    en: "By default, benefits plan documents (SPDs, summaries of material modifications, benefit summaries) are delivered on paper. You can instead choose to receive them electronically through this system.",
    es: "De forma predeterminada, los documentos del plan de beneficios (SPD, resúmenes de modificaciones sustanciales y resúmenes de beneficios) se entregan en papel. Puedes elegir recibirlos electrónicamente a través de este sistema.",
  },
  "account.benefits.consentDescription": {
    en: "This does not cover your own coverage details (tier, member ID, cost) shown on the Benefits page — that's always available regardless of this setting. It only governs formal plan documents your employer is required to furnish. You may withdraw consent at any time in this Settings page.",
    es: "Esto no cubre los detalles de tu propia cobertura (nivel, ID de miembro y costo) que aparecen en la página de Beneficios; siempre están disponibles, independientemente de esta configuración. Esto solo se aplica a los documentos formales del plan que tu empleador debe proporcionar. Puedes retirar tu consentimiento en cualquier momento desde esta página de Configuración.",
  },
  "account.benefits.giveConsent": {
    en: "I consent to electronic benefits document delivery",
    es: "Doy mi consentimiento para recibir electrónicamente los documentos de beneficios",
  },
  "account.details.title": { en: "My details", es: "Mis datos" },
  "account.details.tab.basic": { en: "Basic info", es: "Información básica" },
  "account.details.tab.work": { en: "Work", es: "Trabajo" },
  "account.details.tab.timeClock": { en: "Time clock", es: "Control de horas" },
  "account.details.tab.leave": { en: "Leave", es: "Permisos" },
  "account.details.tab.payroll": { en: "Payroll", es: "Nómina" },
  "account.details.tab.documents": { en: "Documents", es: "Documentos" },
  "account.details.tab.benefits": { en: "Benefits", es: "Beneficios" },
  "account.details.tab.training": { en: "Training", es: "Capacitación" },
  "account.details.personal": { en: "Personal", es: "Información personal" },
  "account.details.gender": { en: "Gender", es: "Género" },
  "account.details.maritalStatus": { en: "Marital status", es: "Estado civil" },
  "account.details.dateOfBirth": { en: "Date of birth", es: "Fecha de nacimiento" },
  "account.details.nationality": { en: "Nationality", es: "Nacionalidad" },
  "account.details.education": { en: "Education", es: "Educación" },
  "account.details.ssn": { en: "SSN", es: "Número de Seguro Social" },
  "account.details.phone": { en: "Phone", es: "Teléfono" },
  "account.details.address": { en: "Address", es: "Dirección" },
  "account.details.emergencyContact": {
    en: "Emergency contact",
    es: "Contacto de emergencia",
  },
  "account.details.emergencyPhone": {
    en: "Emergency phone",
    es: "Teléfono de emergencia",
  },
  "account.details.employment": { en: "Employment", es: "Empleo" },
  "account.details.jobTitle": { en: "Job title", es: "Puesto" },
  "account.details.position": { en: "Position", es: "Cargo" },
  "account.details.department": { en: "Department", es: "Departamento" },
  "account.details.supervisor": { en: "Supervisor", es: "Supervisor" },
  "account.details.dateOfHire": { en: "Date of hire", es: "Fecha de contratación" },
  "account.details.employmentType": { en: "Employment type", es: "Tipo de empleo" },
  "account.details.workEmail": { en: "Work email", es: "Correo electrónico laboral" },
  "account.details.workPhone": { en: "Work phone", es: "Teléfono laboral" },
  "account.details.terminationDate": {
    en: "Termination date",
    es: "Fecha de terminación",
  },
  "account.details.terminationReason": {
    en: "Termination reason",
    es: "Motivo de terminación",
  },
  "account.details.jobDescription": {
    en: "Job description",
    es: "Descripción del puesto",
  },
  "account.details.compensation": { en: "Compensation", es: "Compensación" },
  "account.details.compensationType": {
    en: "Compensation type",
    es: "Tipo de compensación",
  },
  "account.details.compensationValue": {
    en: "Compensation value",
    es: "Importe de compensación",
  },
  "account.details.defaultHourlyRate": {
    en: "Default hourly rate",
    es: "Tarifa por hora predeterminada",
  },
  "account.details.hourlyRate": { en: "{amount}/hr", es: "{amount}/h" },
  "account.details.primaryJobCode": {
    en: "Primary job code",
    es: "Código de puesto principal",
  },
  "account.details.jobCodeAssignments": {
    en: "Job code assignments ({count})",
    es: "Asignaciones de códigos de puesto ({count})",
  },
  "account.details.noJobCodes": {
    en: "No job codes assigned.",
    es: "No hay códigos de puesto asignados.",
  },
  "account.details.primary": { en: "Primary", es: "Principal" },
  "account.details.recentTimeEntries": {
    en: "Recent time entries ({count})",
    es: "Registros de horas recientes ({count})",
  },
  "account.details.noTimeEntries": {
    en: "No time entries yet.",
    es: "Todavía no hay registros de horas.",
  },
  "account.details.kioskTitle": { en: "Kiosk: {name}", es: "Quiosco: {name}" },
  "account.details.leaveSummary": {
    en: "Leave summary · {available}/{allowed} remaining",
    es: "Resumen de permisos · quedan {available}/{allowed}",
  },
  "account.details.noLeaveRequests": {
    en: "No leave requests yet.",
    es: "Todavía no hay solicitudes de permiso.",
  },
  "account.details.daysShort": { en: "d", es: " d" },
  "account.details.payrollDocuments": {
    en: "Payroll documents ({count})",
    es: "Documentos de nómina ({count})",
  },
  "account.details.noPayrollDocuments": {
    en: "No payroll documents yet.",
    es: "Todavía no hay documentos de nómina.",
  },
  "account.details.noPersonalDocs": {
    en: "No personal or onboarding documents yet.",
    es: "Todavía no hay documentos personales ni de incorporación.",
  },
  "account.details.benefitsRedirect": {
    en: "Your medical, dental, vision, and 401(k) info now lives on a dedicated page.",
    es: "La información médica, dental, de visión y del plan 401(k) ahora está en una página dedicada.",
  },
  "account.details.goToBenefits": { en: "Go to Benefits", es: "Ir a Beneficios" },
  "account.details.noTrainingRecords": {
    en: "No training records yet.",
    es: "Todavía no hay registros de capacitación.",
  },
  "account.details.openDocument": { en: "Open", es: "Abrir" },
};
