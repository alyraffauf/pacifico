export interface EmailVerificationDeps {
  checkVerified: () => Promise<boolean>;
  onVerified: () => Promise<void>;
}

export function createEmailVerificationPoller(
  deps: EmailVerificationDeps,
): { checkAndAdvance: () => Promise<boolean> } {
  let checking = false;

  return {
    async checkAndAdvance(): Promise<boolean> {
      if (checking) return false;

      checking = true;
      try {
        const verified = await deps.checkVerified();
        if (!verified) return false;

        await deps.onVerified();
        return true;
      } catch {
        return false;
      } finally {
        checking = false;
      }
    },
  };
}
