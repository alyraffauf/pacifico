declare const __step: unique symbol;

export type TotpIdle = {
  readonly step: "idle";
  readonly [__step]: "idle";
};

export type TotpQr = {
  readonly step: "qr";
  readonly qrBase64: string;
  readonly totpUri: string;
  readonly [__step]: "qr";
};

export type TotpVerify = {
  readonly step: "verify";
  readonly qrBase64: string;
  readonly totpUri: string;
  readonly [__step]: "verify";
};

export type TotpBackup = {
  readonly step: "backup";
  readonly backupCodes: readonly string[];
  readonly [__step]: "backup";
};

export type TotpSetupState = TotpIdle | TotpQr | TotpVerify | TotpBackup;

export const idleState: TotpIdle = { step: "idle" } as TotpIdle;

export function qrState(qrBase64: string, totpUri: string): TotpQr {
  return { step: "qr", qrBase64, totpUri } as TotpQr;
}

export function verifyState(state: TotpQr): TotpVerify {
  return {
    step: "verify",
    qrBase64: state.qrBase64,
    totpUri: state.totpUri,
  } as TotpVerify;
}

export function backupState(
  state: TotpVerify,
  backupCodes: readonly string[],
): TotpBackup {
  void state;
  return { step: "backup", backupCodes } as TotpBackup;
}

export function goBackToQr(state: TotpVerify): TotpQr {
  return {
    step: "qr",
    qrBase64: state.qrBase64,
    totpUri: state.totpUri,
  } as TotpQr;
}

export function finish(_state: TotpBackup): TotpIdle {
  return idleState;
}

export function isBackup(state: TotpSetupState): state is TotpBackup {
  return state.step === "backup";
}
