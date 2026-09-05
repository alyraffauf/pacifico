export interface PublicKeyCredentialDescriptorJSON {
  type: "public-key";
  id: string;
  transports?: AuthenticatorTransport[];
}

export interface PublicKeyCredentialUserEntityJSON {
  id: string;
  name: string;
  displayName: string;
}

export interface PublicKeyCredentialRpEntityJSON {
  name: string;
  id?: string;
}

export interface PublicKeyCredentialParametersJSON {
  type: "public-key";
  alg: number;
}

export interface AuthenticatorSelectionCriteriaJSON {
  authenticatorAttachment?: AuthenticatorAttachment;
  residentKey?: ResidentKeyRequirement;
  requireResidentKey?: boolean;
  userVerification?: UserVerificationRequirement;
}

export interface PublicKeyCredentialCreationOptionsJSON {
  rp: PublicKeyCredentialRpEntityJSON;
  user: PublicKeyCredentialUserEntityJSON;
  challenge: string;
  pubKeyCredParams: PublicKeyCredentialParametersJSON[];
  timeout?: number;
  excludeCredentials?: PublicKeyCredentialDescriptorJSON[];
  authenticatorSelection?: AuthenticatorSelectionCriteriaJSON;
  attestation?: AttestationConveyancePreference;
}

export interface PublicKeyCredentialRequestOptionsJSON {
  challenge: string;
  timeout?: number;
  rpId?: string;
  allowCredentials?: PublicKeyCredentialDescriptorJSON[];
  userVerification?: UserVerificationRequirement;
}

export interface WebAuthnCreationOptionsResponse {
  publicKey: PublicKeyCredentialCreationOptionsJSON;
}

export interface WebAuthnRequestOptionsResponse {
  publicKey: PublicKeyCredentialRequestOptionsJSON;
}

export interface CredentialAssertionJSON {
  id: string;
  type: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
}

export interface CredentialAttestationJSON {
  id: string;
  type: string;
  rawId: string;
  response: {
    clientDataJSON: string;
    attestationObject: string;
  };
}

export function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0)).buffer;
}

export function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join(
    "",
  );
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

export function prepareCreationOptions(
  options: WebAuthnCreationOptionsResponse,
): PublicKeyCredentialCreationOptions {
  const pk = options.publicKey;
  return {
    ...pk,
    challenge: base64UrlToArrayBuffer(pk.challenge),
    user: {
      ...pk.user,
      id: base64UrlToArrayBuffer(pk.user.id),
    },
    excludeCredentials: (pk.excludeCredentials ?? []).map((cred) => ({
      ...cred,
      id: base64UrlToArrayBuffer(cred.id),
    })),
  };
}

export function prepareRequestOptions(
  options: WebAuthnRequestOptionsResponse,
): PublicKeyCredentialRequestOptions {
  const pk = options.publicKey;
  return {
    ...pk,
    challenge: base64UrlToArrayBuffer(pk.challenge),
    allowCredentials: (pk.allowCredentials ?? []).map((cred) => ({
      ...cred,
      id: base64UrlToArrayBuffer(cred.id),
    })),
  };
}

export function serializeAttestationResponse(
  credential: PublicKeyCredential,
): CredentialAttestationJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    type: credential.type,
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(response.attestationObject),
    },
  };
}

export function serializeAssertionResponse(
  credential: PublicKeyCredential,
): CredentialAssertionJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    type: credential.type,
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64Url(response.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(response.authenticatorData),
      signature: arrayBufferToBase64Url(response.signature),
      userHandle: response.userHandle
        ? arrayBufferToBase64Url(response.userHandle)
        : null,
    },
  };
}
