// Shared color palette - warm cream/rose, used across every screen so the app
// reads as one consistent system instead of per-screen one-off hex values.
export const colors = {
  background: "#F6F1EA",
  surface: "#FFFFFF",
  surfaceAlt: "#FBF7F2",
  border: "#EAE0D6",

  textPrimary: "#241E1B",
  textSecondary: "#8F7E74",
  textMuted: "#B3A79D",
  onSurfaceInverse: "#FFFFFF",

  // Rose/maroon - primary brand accent (buttons, links, active states, hero card).
  accent: "#A34C59",
  accentDark: "#8C3F4B",
  accentSoft: "#F4D9DA",

  // Peach/amber - overdue and recurring.
  warning: "#B3763F",
  warningSoft: "#F1DCC2",

  // Sage green - later today / completed / done.
  success: "#6E8F5B",
  successSoft: "#DEE8D2",

  // Muted red - destructive actions only.
  danger: "#B4433F",
  dangerSoft: "#F4DAD8",
} as const;
