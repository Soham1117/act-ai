export const serverErrorMessages: Record<string, { en: string; es: string }> = {
  "errors.auth.youAreNotSignedInSign_6a02d": {
    en: "You are not signed in. Sign in again, then change your password.",
    es: "No has iniciado sesión. Vuelve a iniciar sesión y luego cambia tu contraseña.",
  },
  "errors.auth.newPasswordMustBeAtLeast_28ba5": {
    en: "New password must be at least 8 characters. Choose a longer password.",
    es: "La nueva contraseña debe tener al menos 8 caracteres. Elige una contraseña más larga.",
  },
  "errors.auth.newPasswordIsTooLongMax_463f1": {
    en: "New password is too long (max 72 characters).",
    es: "La nueva contraseña es demasiado larga (máximo 72 caracteres).",
  },
  "errors.auth.chooseANewPasswordThatIs_e9a27": {
    en: "Choose a new password that is different from your current one.",
    es: "Elige una contraseña nueva que sea distinta de la actual.",
  },
  "errors.auth.tooManyAttemptsTryAgainIn_52eb8": {
    en: "Too many attempts. Try again in a few minutes.",
    es: "Demasiados intentos. Vuelve a intentarlo en unos minutos.",
  },
  "errors.auth.currentPasswordIsIncorrectReenterIt_1e015": {
    en: "Current password is incorrect. Re-enter it and try again.",
    es: "La contraseña actual es incorrecta. Escríbela de nuevo e inténtalo otra vez.",
  },
  "errors.employees.thatUsernameIsAlreadyTakenPick_17523": {
    en: "That username is already taken. Pick another.",
    es: "Ese nombre de usuario ya está en uso. Elige otro.",
  },
  "errors.employees.thatCompanyEmailAlreadyBelongsTo_dc726": {
    en: "That company email already belongs to an employee. Use a different login email.",
    es: "Ese correo de la empresa ya pertenece a un empleado. Usa otro correo para iniciar sesión.",
  },
  "errors.employees.thatCompanyEmailIsAlreadyOn_955ba": {
    en: "That company email is already on an employee record. Use a different email.",
    es: "Ese correo de la empresa ya está asociado a un registro de empleado. Usa otro correo.",
  },
  "errors.employees.thatDepartmentNoLongerExistsRefresh_2fe3f": {
    en: "That department no longer exists. Refresh and pick another.",
    es: "Ese departamento ya no existe. Actualiza la página y elige otro.",
  },
  "errors.employees.thatEmployeeWasNotFoundRefresh_88e26": {
    en: "That employee was not found. Refresh the page and try again.",
    es: "No se encontró a ese empleado. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.employees.thatSupervisorNoLongerExistsRefresh_19a44": {
    en: "That supervisor no longer exists. Refresh and pick another.",
    es: "Ese supervisor ya no existe. Actualiza la página y elige otro.",
  },
  "errors.employees.thatJobCodeNoLongerExists_a1eac": {
    en: "That job code no longer exists. Refresh and pick another.",
    es: "Ese código de puesto ya no existe. Actualiza la página y elige otro.",
  },
  "errors.employees.thisHireIsAwaitingReviewUse_969db": {
    en: "This hire is awaiting review. Use Approve to activate the account.",
    es: "Esta contratación está pendiente de revisión. Usa Aprobar para activar la cuenta.",
  },
  "errors.employees.youCantTerminateYourOwnAccount_2d6aa": {
    en: "You can't terminate your own account.",
    es: "No puedes dar de baja tu propia cuenta.",
  },
  "errors.employees.thisHireIsNoLongerAwaiting_fc0c4": {
    en: "This hire is no longer awaiting review. Refresh the page.",
    es: "Esta contratación ya no está pendiente de revisión. Actualiza la página.",
  },
  "errors.employees.onlyHiresAwaitingReviewCanBe_dd085": {
    en: "Only hires awaiting review can be rejected. Use Terminate for anyone else.",
    es: "Solo se pueden rechazar contrataciones pendientes de revisión. Para los demás, usa Dar de baja.",
  },
  "errors.employees.youCantChangeYourOwnRole_373f4": {
    en: "You can't change your own role. Ask another admin.",
    es: "No puedes cambiar tu propio rol. Pídeselo a otro administrador.",
  },
  "errors.employees.onlyActiveEmployeesCanBeMade_ddbe6": {
    en: "Only active employees can be made admins.",
    es: "Solo los empleados activos pueden convertirse en administradores.",
  },
  "errors.employees.enterAValidPersonalEmailAddress_1bee7": {
    en: "Enter a valid personal email address (codes are sent here for sign-in).",
    es: "Ingresa una dirección de correo personal válida (aquí se envían los códigos para iniciar sesión).",
  },
  "errors.employees.currentPasswordIsIncorrectReenterIt_1e015": {
    en: "Current password is incorrect. Re-enter it and try again.",
    es: "La contraseña actual es incorrecta. Escríbela de nuevo e inténtalo otra vez.",
  },
  "errors.employees.selectAtLeastOneEmployeeTo_b5f44": {
    en: "Select at least one employee to delete.",
    es: "Selecciona al menos un empleado para eliminar.",
  },
  "errors.employees.someSelectedEmployeesNoLongerExist_7be6f": {
    en: "Some selected employees no longer exist. Refresh the page and try again.",
    es: "Algunos de los empleados seleccionados ya no existen. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.employees.youCantDeleteYourOwnAccount_89bdb": {
    en: "You can't delete your own account.",
    es: "No puedes eliminar tu propia cuenta.",
  },
  "errors.employees.selectAtLeastOneEmployee_a34e7": {
    en: "Select at least one employee.",
    es: "Selecciona al menos un empleado.",
  },
  "errors.employees.nothingToTerminateTheSelectionIs_9784d": {
    en: "Nothing to terminate: the selection is already terminated, or contains admins or yourself.",
    es: "No hay nadie a quien dar de baja: la selección ya incluye personas dadas de baja, administradores o tu propia cuenta.",
  },
  "errors.requests.yourAccountHasNoEmployeeProfile_7f914": {
    en: "Your account has no employee profile yet. Ask an admin to create one before you can submit a request.",
    es: "Tu cuenta aún no tiene un perfil de empleado. Pídele a un administrador que lo cree antes de enviar una solicitud.",
  },
  "errors.requests.timeOffIsRequestedFromThe_64376": {
    en: "Time off is requested from the Leave page, where your balance and dates are checked. Open Leave and use Request leave.",
    es: "Los permisos se solicitan desde la página Permisos, donde se verifican tu saldo y las fechas. Abre Permisos y selecciona Solicitar permiso.",
  },
  "errors.requests.enterAReasonForRejectingThis_f09ec": {
    en: "Enter a reason for rejecting this request. The employee will see it.",
    es: "Ingresa un motivo para rechazar esta solicitud. El empleado podrá verlo.",
  },
  "errors.requests.yourAccountHasNoEmployeeProfile_953ae": {
    en: "Your account has no employee profile.",
    es: "Tu cuenta no tiene un perfil de empleado.",
  },
  "errors.reimbursements.yourAccountHasNoEmployeeProfile_5421b": {
    en: "Your account has no employee profile yet. Ask an admin to create one before you can submit a reimbursement.",
    es: "Tu cuenta aún no tiene un perfil de empleado. Pídele a un administrador que lo cree antes de enviar un reembolso.",
  },
  "errors.reimbursements.enterAValidExpenseDate_93621": {
    en: "Enter a valid expense date.",
    es: "Ingresa una fecha de gasto válida.",
  },
  "errors.reimbursements.theExpenseDateCantBeIn_1ddc7": {
    en: "The expense date can't be in the future.",
    es: "La fecha del gasto no puede ser futura.",
  },
  "errors.reimbursements.enterAReasonForRejectingThis_0d97b": {
    en: "Enter a reason for rejecting this claim. The employee will see it.",
    es: "Ingresa un motivo para rechazar este reclamo. El empleado podrá verlo.",
  },
  "errors.leave.onlyAdminsCanCreateLeaveFor_05f0f": {
    en: "Only admins can create leave for another employee.",
    es: "Solo los administradores pueden registrar permisos para otro empleado.",
  },
  "errors.leave.yourAccountHasNoEmployeeProfile_0ab21": {
    en: "Your account has no employee profile yet. Ask an admin to create one before you can submit leave.",
    es: "Tu cuenta aún no tiene un perfil de empleado. Pídele a un administrador que lo cree antes de solicitar un permiso.",
  },
  "errors.leave.enterValidStartAndEndDates_0926c": {
    en: "Enter valid start and end dates.",
    es: "Ingresa fechas de inicio y fin válidas.",
  },
  "errors.leave.theEndDateMustBeOn_02af6": {
    en: "The end date must be on or after the start date. Adjust the dates and try again.",
    es: "La fecha de fin debe ser igual o posterior a la fecha de inicio. Ajusta las fechas e inténtalo de nuevo.",
  },
  "errors.leave.leaveRequestsCannotSpanMoreThan_e148a": {
    en: "Leave requests cannot span more than one year. Split it into separate requests.",
    es: "Las solicitudes de permiso no pueden abarcar más de un año. Divídelas en solicitudes separadas.",
  },
  "errors.leave.startDateCannotBeInThe_75736": {
    en: "Start date cannot be in the past. Pick today or a later date.",
    es: "La fecha de inicio no puede ser anterior a hoy. Elige hoy o una fecha posterior.",
  },
  "errors.leave.thatRangeHasNoWorkingDays_020d6": {
    en: "That range has no working days (weekends are not counted). Pick at least one weekday.",
    es: "Ese intervalo no incluye días laborables (no se cuentan los fines de semana). Elige al menos un día entre semana.",
  },
  "errors.leave.enterAReasonForRejectingThis_f09ec": {
    en: "Enter a reason for rejecting this request. The employee will see it.",
    es: "Ingresa un motivo para rechazar esta solicitud. El empleado podrá verlo.",
  },
  "errors.leave.enterAReasonForApprovingBeyond_a9995": {
    en: "Enter a reason for approving beyond the employee's balance.",
    es: "Ingresa un motivo para aprobar un permiso que excede el saldo del empleado.",
  },
  "errors.leave.enterANonzeroNumberOfDays_e5af1": {
    en: "Enter a non-zero number of days (use a minus sign to deduct).",
    es: "Ingresa una cantidad de días distinta de cero (usa el signo menos para descontar días).",
  },
  "errors.leave.thatAdjustmentIsTooLarge_5e3aa": {
    en: "That adjustment is too large.",
    es: "Ese ajuste es demasiado grande.",
  },
  "errors.leave.thatEmployeeNoLongerExistsRefresh_a4033": {
    en: "That employee no longer exists. Refresh the page.",
    es: "Ese empleado ya no existe. Actualiza la página.",
  },
  "errors.payroll.thePayPeriodEndCantBe_766c1": {
    en: "The pay period end can't be before the period start.",
    es: "El fin del período de nómina no puede ser anterior al inicio del período.",
  },
  "errors.payroll.thatEmployeeNoLongerExistsRefresh_9a6e4": {
    en: "That employee no longer exists. Refresh the page and pick someone else.",
    es: "Ese empleado ya no existe. Actualiza la página y elige a otra persona.",
  },
  "errors.payroll.thatPayrollDocumentNoLongerExists_76790": {
    en: "That payroll document no longer exists. Refresh the page and try again.",
    es: "Ese documento de nómina ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.payroll.thatPayPeriodWasAlreadyDeleted_910de": {
    en: "That pay period was already deleted. Refresh the page.",
    es: "Ese período de nómina ya se eliminó. Actualiza la página.",
  },
  "errors.benefits.enterAValidPlanYearStart_a9f16": {
    en: "Enter a valid plan year start and end date.",
    es: "Ingresa fechas válidas de inicio y fin del año del plan.",
  },
  "errors.benefits.thePlanYearMustEndAfter_5a916": {
    en: "The plan year must end after it starts.",
    es: "El año del plan debe terminar después de que comienza.",
  },
  "errors.benefits.thatEnrollmentNoLongerExistsRefresh_a21bc": {
    en: "That enrollment no longer exists. Refresh the page and try again.",
    es: "Esa inscripción ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.benefits.anExistingEnrollmentsEmployeeAndPlan_9e934": {
    en: "An existing enrollment's employee and plan can't be changed. End it and create a new one.",
    es: "No se pueden cambiar el empleado ni el plan de una inscripción existente. Finalízala y crea una nueva.",
  },
  "errors.benefits.enterAValidEffectiveDate_05361": {
    en: "Enter a valid effective date.",
    es: "Ingresa una fecha de vigencia válida.",
  },
  "errors.benefits.thatEmployeeNoLongerExistsRefresh_77839": {
    en: "That employee no longer exists. Refresh the page and pick another employee.",
    es: "Ese empleado ya no existe. Actualiza la página y elige a otro empleado.",
  },
  "errors.benefits.thatBenefitPlanNoLongerExists_90dc3": {
    en: "That benefit plan no longer exists. Refresh the page and pick another plan.",
    es: "Ese plan de beneficios ya no existe. Actualiza la página y elige otro plan.",
  },
  "errors.benefits.useThe401kElectionFormFor_59cc5": {
    en: "Use the 401(k) election form for retirement plans.",
    es: "Usa el formulario de elección 401(k) para los planes de jubilación.",
  },
  "errors.benefits.onlyAPendingEnrollmentCanBe_50281": {
    en: "Only a pending enrollment can be confirmed. Refresh the page.",
    es: "Solo se puede confirmar una inscripción pendiente. Actualiza la página.",
  },
  "errors.benefits.thatEnrollmentHasAlreadyEndedThere_881a9": {
    en: "That enrollment has already ended; there is nothing to confirm.",
    es: "Esa inscripción ya finalizó; no hay nada que confirmar.",
  },
  "errors.benefits.thatEnrollmentHasAlreadyEndedSo_3b307": {
    en: "That enrollment has already ended, so its tier can't be changed. Enroll the employee again instead.",
    es: "Esa inscripción ya finalizó, por lo que no se puede cambiar su nivel. En su lugar, vuelve a inscribir al empleado.",
  },
  "errors.benefits.aWaivedBenefitHasNoTier_726ab": {
    en: "A waived benefit has no tier to change. Create a new enrollment instead.",
    es: "Un beneficio rechazado no tiene un nivel que se pueda cambiar. En su lugar, crea una inscripción nueva.",
  },
  "errors.benefits.theNewTiersEffectiveDateMust_d959b": {
    en: "The new tier's effective date must be after the current enrollment's effective date. Pick a later date and try again.",
    es: "La fecha de vigencia del nuevo nivel debe ser posterior a la fecha de vigencia de la inscripción actual. Elige una fecha posterior e inténtalo de nuevo.",
  },
  "errors.benefits.thatEmployeeNoLongerExistsRefresh_dd3a1": {
    en: "That employee no longer exists. Refresh the page and try again.",
    es: "Ese empleado ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.benefits.enterAValidEndDate_14fae": {
    en: "Enter a valid end date.",
    es: "Ingresa una fecha de fin válida.",
  },
  "errors.benefits.thatElectionNoLongerExistsRefresh_a8c23": {
    en: "That election no longer exists. Refresh the page and try again.",
    es: "Esa elección ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.benefits.anExistingElectionsEmployeeAndPlan_2087d": {
    en: "An existing election's employee and plan can't be changed. End it and create a new one.",
    es: "No se pueden cambiar el empleado ni el plan de una elección existente. Finalízala y crea una nueva.",
  },
  "errors.benefits.pickA401kPlanForA_5677f": {
    en: "Pick a 401(k) plan for a retirement election.",
    es: "Elige un plan 401(k) para una elección de jubilación.",
  },
  "errors.benefits.onlyAPendingElectionCanBe_08d94": {
    en: "Only a pending election can be confirmed. Refresh the page.",
    es: "Solo se puede confirmar una elección pendiente. Actualiza la página.",
  },
  "errors.benefits.thatElectionHasAlreadyEndedThere_510a7": {
    en: "That election has already ended; there is nothing to confirm.",
    es: "Esa elección ya finalizó; no hay nada que confirmar.",
  },
  "errors.benefits.enterAValidStartAndEnd_eceb1": {
    en: "Enter a valid start and end date for the new plan year.",
    es: "Ingresa fechas válidas de inicio y fin para el nuevo año del plan.",
  },
  "errors.benefits.theNewPlanYearMustEnd_1ce63": {
    en: "The new plan year must end after it starts.",
    es: "El nuevo año del plan debe terminar después de que comienza.",
  },
  "errors.benefits.thisPlanWasAlreadyRolledForward_4e1c3": {
    en: "This plan was already rolled forward. Refresh the page.",
    es: "Este plan ya se trasladó al siguiente período. Actualiza la página.",
  },
  "errors.documents.noEmployeeProfileIsLinkedTo_3373a": {
    en: "No employee profile is linked to your account for this upload. Ask an admin to create one, or pick an employee if you are an admin.",
    es: "No hay ningún perfil de empleado vinculado a tu cuenta para esta carga. Pídele a un administrador que cree uno, o elige un empleado si eres administrador.",
  },
  "errors.documents.youCanOnlyUploadDocumentsTo_a6834": {
    en: "You can only upload documents to your own employee profile.",
    es: "Solo puedes cargar documentos en tu propio perfil de empleado.",
  },
  "errors.documents.onlyAdminsCanUploadCompanyOr_188f7": {
    en: "Only admins can upload company or benefits documents.",
    es: "Solo los administradores pueden cargar documentos de la empresa o de beneficios.",
  },
  "errors.documents.thatEmployeeNoLongerExistsRefresh_dd3a1": {
    en: "That employee no longer exists. Refresh the page and try again.",
    es: "Ese empleado ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.documents.selectAtLeastOneEmployeeOr_e3817": {
    en: "Select at least one employee (or choose all active employees).",
    es: "Selecciona al menos un empleado (o elige todos los empleados activos).",
  },
  "errors.documents.noneOfTheSelectedEmployeesExist_acf76": {
    en: "None of the selected employees exist any more. Refresh the page and try again.",
    es: "Ninguno de los empleados seleccionados existe ya. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.documents.thatDocumentNoLongerExistsRefresh_a242d": {
    en: "That document no longer exists. Refresh the page and try again.",
    es: "Ese documento ya no existe. Actualiza la página e inténtalo de nuevo.",
  },
  "errors.documents.youCanOnlyDeleteDocumentsYou_b863b": {
    en: "You can only delete documents you uploaded yourself. Ask an admin if you need this removed.",
    es: "Solo puedes eliminar los documentos que tú mismo cargaste. Si necesitas que se elimine otro, pídeselo a un administrador.",
  },
  "errors.notifications.noActiveEmployeesMatchedYourRecipient_d0ffd": {
    en: "No active employees matched your recipient filters. Pick different employees or departments and try again.",
    es: "Ningún empleado activo coincide con los filtros de destinatarios. Elige otros empleados o departamentos e inténtalo de nuevo.",
  },
  "errors.notifications.yourAccountHasNoEmployeeProfile_2f20c": {
    en: "Your account has no employee profile yet. Ask an admin to create one before you can manage notifications.",
    es: "Tu cuenta aún no tiene un perfil de empleado. Pídele a un administrador que lo cree antes de administrar las notificaciones.",
  },
  "errors.onboarding.thatDepartmentNoLongerExistsRefresh_2fe3f": {
    en: "That department no longer exists. Refresh and pick another.",
    es: "Ese departamento ya no existe. Actualiza la página y elige otro.",
  },
  "errors.onboarding.thisInviteWasAlreadyUsedOr_5f4fa": {
    en: "This invite was already used or revoked. Refresh the page.",
    es: "Esta invitación ya se usó o se revocó. Actualiza la página.",
  },
  "errors.onboarding.thisOnboardingInviteWasNotFound_77f61": {
    en: "This onboarding invite was not found. Ask your admin for a new invite link.",
    es: "No se encontró esta invitación de incorporación. Pídele a tu administrador un enlace de invitación nuevo.",
  },
  "errors.onboarding.tooManyAttemptsWaitAFew_76d7a": {
    en: "Too many attempts. Wait a few minutes and try again.",
    es: "Demasiados intentos. Espera unos minutos e inténtalo de nuevo.",
  },
  "errors.onboarding.thisOnboardingInviteWasAlreadyUsed_3d1a0": {
    en: "This onboarding invite was already used. Sign in if you already finished, or ask your admin for a new invite.",
    es: "Esta invitación de incorporación ya se usó. Inicia sesión si ya completaste el proceso o pídele a tu administrador una invitación nueva.",
  },
  "errors.onboarding.thisOnboardingInviteHasExpiredAsk_420fc": {
    en: "This onboarding invite has expired. Ask your admin to send a new invite link.",
    es: "Esta invitación de incorporación venció. Pídele a tu administrador que envíe un enlace nuevo.",
  },
  "errors.onboarding.thatWorkEmailIsAlreadyOn_6182a": {
    en: "That work email is already on an employee record. Use a different email.",
    es: "Ese correo laboral ya está asociado a un registro de empleado. Usa otro correo.",
  },
  "errors.time-clock.enterAReasonForRejectingThis_ab30f": {
    en: "Enter a reason for rejecting this entry. The employee will see it.",
    es: "Ingresa un motivo para rechazar este registro de horas. El empleado podrá verlo.",
  },
  "errors.time-clock.thatTimeEntryNoLongerExists_fb2dd": {
    en: "That time entry no longer exists. Refresh the page.",
    es: "Ese registro de horas ya no existe. Actualiza la página.",
  },
  "errors.time-clock.enterAReasonForRejectingThese_86970": {
    en: "Enter a reason for rejecting these entries. Employees will see it.",
    es: "Ingresa un motivo para rechazar estos registros de horas. Los empleados podrán verlo.",
  },
  "errors.time-clock.noneOfTheSelectedEntriesAre_9fada": {
    en: "None of the selected entries are pending review any more. Refresh the page.",
    es: "Ninguno de los registros seleccionados está pendiente de revisión. Actualiza la página.",
  },
  "errors.auth.invalidCredentials": {
    en: "Invalid email/username or password. Check both and try again.",
    es: "El correo, nombre de usuario o contraseña no son válidos. Verifica los datos e inténtalo de nuevo.",
  },
  "errors.auth.login_52eb86aa": {
    en: "Too many attempts. Try again in a few minutes.",
    es: "Demasiados intentos. Vuelve a intentarlo en unos minutos.",
  },
  "errors.auth.login_90a921f5": {
    en: "This account no longer has access. If you think that's a mistake, contact your administrator.",
    es: "Esta cuenta ya no tiene acceso. Si crees que se trata de un error, comunícate con tu administrador.",
  },
  "errors.auth.login_af94f673": {
    en: "No personal email on file for 2FA. Ask an admin to add one before you can sign in.",
    es: "No hay un correo personal registrado para la verificación en dos pasos. Pídele a un administrador que agregue uno antes de iniciar sesión.",
  },
  "errors.auth.login_ac2e8cd0": {
    en: "Could not send the sign-in code. Try again shortly.",
    es: "No se pudo enviar el código de inicio de sesión. Vuelve a intentarlo en breve.",
  },
  "errors.auth.login_cb3ae152": {
    en: "Too many attempts. Request a new code.",
    es: "Demasiados intentos. Solicita un código nuevo.",
  },
  "errors.auth.login_ffa8ce67": {
    en: "Incorrect or expired code.",
    es: "El código es incorrecto o venció.",
  },
};
