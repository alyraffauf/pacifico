import type { DidType, VerificationChannel } from "../api.ts";
import type {
  AccessToken,
  Did,
  Handle,
  RefreshToken,
} from "../types/branded.ts";

export type RegistrationMode = "password" | "passkey";

export type RegistrationStep =
  | "info"
  | "key-choice"
  | "initial-did-doc"
  | "creating"
  | "passkey"
  | "app-password"
  | "verify"
  | "updated-did-doc"
  | "activating"
  | "redirect-to-dashboard";

export interface RegistrationInfo {
  handle: string;
  email: string;
  password?: string;
  inviteCode?: string;
  didType: DidType;
  externalDid?: string;
  verificationChannel: VerificationChannel;
  discordUsername?: string;
  telegramUsername?: string;
  signalUsername?: string;
}

export interface ExternalDidWebState {
  keyMode: "reserved" | "byod";
  reservedSigningKey?: string;
  byodPrivateKey?: Uint8Array;
  byodPublicKeyMultibase?: string;
  initialDidDocument?: string;
  updatedDidDocument?: string;
}

export interface AccountResult {
  did: Did;
  handle: Handle;
  setupToken?: string;
  appPassword?: string;
  appPasswordName?: string;
}

export interface SessionState {
  accessJwt: AccessToken;
  refreshJwt: RefreshToken;
}
