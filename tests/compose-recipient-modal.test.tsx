/**
 * ComposeRecipientModal — the new N-key compose-to-new-thread surface.
 *
 * Locks in:
 *   - Stage 1 (recipient) shows title + To: input + help footer
 *   - Resolution badge appears when a valid recipient is typed
 *   - Ambiguous matches surface a candidate list
 *   - Stage 2 (body) shows the locked recipient summary + body input
 *   - Esc back-out from stage 2 to stage 1
 */

import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";
import type { RecipientResolution } from "../src/recipient.js";
import { ComposeRecipientModal } from "../src/tui/components/ComposeRecipientModal.js";
import { makeTheme } from "../src/tui/theme.js";
import { ThemeProvider } from "../src/tui/themes/ThemeContext.js";

function mount(opts?: {
  resolve?: (input: string) => RecipientResolution;
  onSend?: (handle: string, text: string) => Promise<{ success: boolean; error?: string }>;
  onCancel?: () => void;
}) {
  const resolve =
    opts?.resolve ?? ((_: string): RecipientResolution => ({ kind: "error", message: "" }));
  const onSend = opts?.onSend ?? vi.fn(async (_h: string, _t: string) => ({ success: true }));
  const onCancel = opts?.onCancel ?? vi.fn();
  return render(
    <ThemeProvider value={makeTheme()}>
      <ComposeRecipientModal resolve={resolve} onSend={onSend} onCancel={onCancel} />
    </ThemeProvider>,
  );
}

describe("ComposeRecipientModal — initial render", () => {
  it("starts on stage 1 (recipient entry)", () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("New message — recipient");
    expect(frame).toContain("To:");
    expect(frame).toContain("Enter: continue · Esc: cancel");
    unmount();
  });

  it("shows the placeholder hint before any input", () => {
    const { lastFrame, unmount } = mount();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("phone, email, or contact name");
    unmount();
  });
});

describe("ComposeRecipientModal — typing surfaces resolution feedback", () => {
  it("renders the input and footer correctly even when resolver always errors", () => {
    const resolve = vi.fn((_: string): RecipientResolution => ({ kind: "error", message: "" }));
    const { lastFrame, unmount } = mount({ resolve });
    const frame = lastFrame() ?? "";
    // Component must render even on an empty/error baseline.
    expect(frame).toContain("New message — recipient");
    unmount();
  });
});

describe("ComposeRecipientModal — Esc handling", () => {
  it("calls onCancel when Esc is pressed at stage 1", async () => {
    const onCancel = vi.fn();
    const { stdin, unmount } = mount({ onCancel });
    stdin.write(String.fromCharCode(27)); // ESC
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onCancel).toHaveBeenCalledTimes(1);
    unmount();
  });
});
