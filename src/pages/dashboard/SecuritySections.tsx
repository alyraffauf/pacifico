import type { ReactNode } from "react";
import {
  IconDeviceLaptop,
  IconKey,
  IconLink,
  IconLock,
  IconShieldCheck,
} from "@tabler/icons-react";
import { Card } from "../../components/ui.tsx";

function SecuritySection({
  icon: SectionIcon,
  title,
  children,
}: {
  icon: typeof IconLock;
  title: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5">
      <h2 className="flex items-center gap-2 font-mono text-base font-semibold text-ctp-text">
        <SectionIcon className="size-5 text-ctp-lavender" aria-hidden="true" />
        {title}
      </h2>
      {children}
    </Card>
  );
}

export function PasswordSection({ children }: { children: ReactNode }) {
  return (
    <SecuritySection icon={IconLock} title="Password">
      {children}
    </SecuritySection>
  );
}

export function AuthenticatorSection({ children }: { children: ReactNode }) {
  return (
    <SecuritySection icon={IconShieldCheck} title="Authenticator app">
      {children}
    </SecuritySection>
  );
}

export function PasskeySection({ children }: { children: ReactNode }) {
  return (
    <SecuritySection icon={IconKey} title="Passkeys">
      {children}
    </SecuritySection>
  );
}

export function TrustedDeviceSection({ children }: { children: ReactNode }) {
  return (
    <SecuritySection icon={IconDeviceLaptop} title="Trusted devices">
      {children}
    </SecuritySection>
  );
}

export function LinkedAccountSection({ children }: { children: ReactNode }) {
  return (
    <SecuritySection icon={IconLink} title="Linked sign-in accounts">
      {children}
    </SecuritySection>
  );
}
