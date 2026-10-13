import type { Widen } from "../../types";

export const en = {
  email: "Email",
  password: "Password",
  passwordHint: "At least 12 characters. A few random words work well.",
  confirmPassword: "Confirm password",
  passwordTooShort: "The password needs at least 12 characters.",
  passwordMismatch: "The two passwords don't match.",
  setupTitle: "Set up your cloud",
  setupIntro: "Create the first account. It will be the admin.",
  setupSubmit: "Create admin account",
  setupSubmitting: "Creating…",
  loginTitle: "Log in",
  loginSubmit: "Log in",
  loginSubmitting: "Logging in…",
  loginNoAccount: "Need an account? Ask the admin of this cloud for an invite link.",
  registerTitle: "Accept your invite",
  registerIntro: "Choose an email and password to create your account.",
  registerSubmit: "Create account",
  registerSubmitting: "Creating…",
  registerMissingToken: "This invite link is incomplete. Ask the admin for a new one.",
  registerHaveAccount: "Already have an account?",
  registerLoginLink: "Log in",
};

export type Auth = Widen<typeof en>;
