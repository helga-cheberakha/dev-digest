/**
 * PeriodPicker.test.tsx
 *
 * Keyboard-interaction tests for the PeriodPicker dropdown.
 *
 * Key behaviors under test:
 *   (a) ArrowDown on the closed trigger opens the listbox and focuses the first option.
 *   (b) Escape while an option is focused closes the listbox and returns focus to the trigger.
 *   (c) ArrowDown/ArrowUp move focus between options.
 *   (d) ArrowUp on the first option closes the listbox and returns focus to the trigger.
 *   (e) Activating a preset option (click; this is what Enter triggers on a native button)
 *       calls onChange and closes the dropdown.
 *
 * Uses `fireEvent` — @testing-library/user-event is not in this package's
 * dependencies (INSIGHTS.md 2026-07-06).
 *
 * next-intl is NOT mocked — real NextIntlClientProvider is used so translation
 * text matches what the component actually renders.
 */

import React from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { PerfWindow } from "@/lib/api";
import agentPerfMessages from "../../../../messages/en/agentPerformance.json";
import { PeriodPicker } from "./PeriodPicker";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_VALUE: PerfWindow = { period: "30d" };

function renderPicker(onChange: (w: PerfWindow) => void = vi.fn()) {
  return render(
    <NextIntlClientProvider
      locale="en"
      messages={{ agentPerformance: agentPerfMessages }}
    >
      <PeriodPicker value={DEFAULT_VALUE} onChange={onChange} />
    </NextIntlClientProvider>,
  );
}

afterEach(() => cleanup());

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PeriodPicker — keyboard interactions", () => {
  describe("opening the listbox", () => {
    it("trigger has aria-expanded=false and no listbox before interaction", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("ArrowDown on the closed trigger opens the listbox (aria-expanded=true)", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("listbox")).toBeInTheDocument();
    });

    it("ArrowDown on the closed trigger focuses the first option after opening", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      // The listbox has three options: 30d, 1d, custom
      const options = screen.getAllByRole("option");
      expect(options).toHaveLength(3);
      // First option ("30 days") should have focus
      expect(options[0]).toHaveFocus();
    });

    it("Enter on the closed trigger opens the listbox and focuses the first option", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "Enter" });

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveFocus();
    });

    it("Space on the closed trigger opens the listbox and focuses the first option", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: " " });

      expect(trigger).toHaveAttribute("aria-expanded", "true");
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveFocus();
    });
  });

  describe("Escape key", () => {
    it("Escape while an option is focused closes the listbox", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      // Open and focus first option
      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      fireEvent.keyDown(options[0]!, { key: "Escape" });

      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("Escape while an option is focused returns focus to the trigger", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      fireEvent.keyDown(options[0]!, { key: "Escape" });

      expect(trigger).toHaveFocus();
    });

    it("Escape from the second option also closes and returns focus to trigger", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      // Move to second option first
      fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
      expect(options[1]).toHaveFocus();

      // Escape from second option
      fireEvent.keyDown(options[1]!, { key: "Escape" });

      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(trigger).toHaveFocus();
    });
  });

  describe("ArrowDown / ArrowUp navigation between options", () => {
    it("ArrowDown moves focus from the first option to the second option", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveFocus();

      fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
      expect(options[1]).toHaveFocus();
    });

    it("ArrowDown moves focus from the second option to the third option", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
      fireEvent.keyDown(options[1]!, { key: "ArrowDown" });
      expect(options[2]).toHaveFocus();
    });

    it("ArrowDown is clamped at the last option (does not wrap)", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      // Navigate to last option
      fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
      fireEvent.keyDown(options[1]!, { key: "ArrowDown" });
      // Try to go past the last option
      fireEvent.keyDown(options[2]!, { key: "ArrowDown" });

      // Focus should still be on the last option
      expect(options[2]).toHaveFocus();
    });

    it("ArrowUp moves focus from the second option back to the first", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");

      // Move to second option
      fireEvent.keyDown(options[0]!, { key: "ArrowDown" });
      expect(options[1]).toHaveFocus();

      // Move back to first
      fireEvent.keyDown(options[1]!, { key: "ArrowUp" });
      expect(options[0]).toHaveFocus();
    });

    it("ArrowUp on the first option (index 0) closes the listbox and returns focus to the trigger", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });
      const options = screen.getAllByRole("option");
      expect(options[0]).toHaveFocus();

      fireEvent.keyDown(options[0]!, { key: "ArrowUp" });

      // Listbox closes
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
      // Focus returns to trigger
      expect(trigger).toHaveFocus();
    });
  });

  describe("selecting a preset option", () => {
    /**
     * In browsers, pressing Enter on a focused <button> fires a click event.
     * We test via fireEvent.click — which is what keyboard Enter ultimately
     * dispatches. The assertion is on the behavioral outcome: onChange fires
     * and the dropdown closes.
     */
    it("clicking (activating) a preset option calls onChange with the correct window", () => {
      const onChange = vi.fn();
      renderPicker(onChange);
      const trigger = screen.getByRole("button", { name: /30 days/i });

      // Open the dropdown
      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      // Click the "1 day" option — equivalent to pressing Enter when focused
      const oneDayOption = screen.getByRole("option", { name: /1 day/i });
      fireEvent.click(oneDayOption);

      expect(onChange).toHaveBeenCalledOnce();
      expect(onChange).toHaveBeenCalledWith({ period: "1d" });
    });

    it("selecting a preset option closes the dropdown", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.keyDown(trigger, { key: "ArrowDown" });

      const oneDayOption = screen.getByRole("option", { name: /1 day/i });
      fireEvent.click(oneDayOption);

      // Listbox is gone after selection
      expect(trigger).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });

    it("selecting the '30 days' preset calls onChange with {period:'30d'}", () => {
      const onChange = vi.fn();
      renderPicker(onChange);
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.click(trigger); // Open via click
      const thirtyDayOption = screen.getByRole("option", { name: /30 days/i });
      fireEvent.click(thirtyDayOption);

      expect(onChange).toHaveBeenCalledWith({ period: "30d" });
    });

    it("selecting 'Custom range' keeps the dropdown open and reveals date inputs", () => {
      const onChange = vi.fn();
      renderPicker(onChange);
      const trigger = screen.getByRole("button", { name: /30 days/i });

      fireEvent.click(trigger);
      const customOption = screen.getByRole("option", { name: /custom range/i });
      fireEvent.click(customOption);

      // Dropdown stays open
      expect(screen.getByRole("listbox")).toBeInTheDocument();
      // Date inputs appear
      expect(screen.getByLabelText(/from/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/to/i)).toBeInTheDocument();
      // onChange has NOT been called yet (custom requires Apply)
      expect(onChange).not.toHaveBeenCalled();
    });

    it("aria-selected is true for the currently active preset option", () => {
      renderPicker();
      const trigger = screen.getByRole("button", { name: /30 days/i });

      // Open the dropdown — pendingMode defaults to current value (30d)
      fireEvent.click(trigger);

      const thirtyDayOption = screen.getByRole("option", { name: /30 days/i });
      const oneDayOption = screen.getByRole("option", { name: /1 day/i });

      expect(thirtyDayOption).toHaveAttribute("aria-selected", "true");
      expect(oneDayOption).toHaveAttribute("aria-selected", "false");
    });
  });
});
