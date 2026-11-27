import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopToolbar } from "@/components/TopToolbar";

describe("TopToolbar accessibility & motion preferences", () => {
  afterEach(() => {
    cleanup();
  });

  function renderToolbar(
    overrides?: Partial<React.ComponentProps<typeof TopToolbar>>
  ) {
    return render(
      <TopToolbar
        title="サンプル文書"
        saveStatus="saved"
        viewMode="split"
        onViewModeChange={vi.fn()}
        onImportMarkdown={vi.fn()}
        onImportFolder={vi.fn()}
        onExportMarkdown={vi.fn()}
        onPrint={vi.fn()}
        isSidebarOpen={true}
        onToggleSidebar={vi.fn()}
        isSettingsOpen={false}
        onToggleSettings={vi.fn()}
        {...overrides}
      />
    );
  }

  it("reflects active viewMode via aria-pressed on mode toggle buttons", () => {
    renderToolbar({ viewMode: "preview" });

    expect(
      screen.getByRole("button", { name: /エディタのみ/ }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /分割表示/ }).getAttribute("aria-pressed")
    ).toBe("false");
    expect(
      screen.getByRole("button", { name: /プレビューのみ/ }).getAttribute("aria-pressed")
    ).toBe("true");
  });

  it("applies motion-reduce:animate-none to the saving indicator spinner", () => {
    const { container } = renderToolbar({ saveStatus: "saving" });
    const spinner = container.querySelector("svg.animate-spin");
    expect(spinner).toBeTruthy();
    expect(spinner?.getAttribute("class")).toContain("motion-reduce:animate-none");
  });

  it("does not expose destructive sample reset button in the top toolbar (#63)", () => {
    renderToolbar();
    expect(screen.queryByRole("button", { name: /サンプル/ })).toBeNull();
  });
});
