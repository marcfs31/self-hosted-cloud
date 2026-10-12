import type { ReactNode } from "react";
import { messages } from "../../lib/messages";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="auth">
      <p className="brand">{messages.app.name}</p>
      {children}
    </main>
  );
}
