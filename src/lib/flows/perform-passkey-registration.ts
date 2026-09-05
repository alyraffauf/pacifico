import {
  type CredentialAttestationJSON,
  prepareCreationOptions,
  serializeAttestationResponse,
  type WebAuthnCreationOptionsResponse,
} from "../webauthn.ts";

export class PasskeyCancelledError extends Error {
  constructor() {
    super("Passkey creation was cancelled");
    this.name = "PasskeyCancelledError";
  }
}

export async function createPasskeyCredential(
  startRegistration: () => Promise<{ options: unknown }>,
): Promise<CredentialAttestationJSON> {
  if (!globalThis.PublicKeyCredential) {
    throw new Error("Passkeys are not supported in this browser");
  }

  const { options } = await startRegistration();

  const publicKeyOptions = prepareCreationOptions(
    options as unknown as WebAuthnCreationOptionsResponse,
  );
  const credential = await navigator.credentials.create({
    publicKey: publicKeyOptions,
  });

  if (!credential) {
    throw new PasskeyCancelledError();
  }

  return serializeAttestationResponse(credential as PublicKeyCredential);
}

export interface PasskeyRegistrationApi {
  startRegistration(): Promise<{ options: unknown }>;
  completeSetup(
    credential: CredentialAttestationJSON,
    name?: string,
  ): Promise<{ appPassword: string; appPasswordName: string }>;
}

export async function performPasskeyRegistration(
  passkeyApi: PasskeyRegistrationApi,
  friendlyName?: string,
): Promise<{ appPassword: string; appPasswordName: string }> {
  const serialized = await createPasskeyCredential(
    passkeyApi.startRegistration,
  );
  return passkeyApi.completeSetup(serialized, friendlyName);
}
