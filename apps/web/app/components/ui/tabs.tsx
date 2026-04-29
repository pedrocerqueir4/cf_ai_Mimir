"use client";
import * as React from "react";
// Composite per RESEARCH § Pattern 2:
//   - Base UI `Tabs.Root` is the structural state container (renders <div>)
//   - Kumo `Tabs` is a *strip-only* component (data-driven via `tabs={[...]}`)
//   - Base UI `Tabs.Panel` renders content matched by value
// Kumo's Tabs alone has no content panel, so the composite is required.
import { Tabs as KumoTabsStrip } from "@cloudflare/kumo/components/tabs";
import { Tabs as BaseTabs } from "@cloudflare/kumo/primitives/tabs";

/**
 * Tabs — structural state container (Base UI Tabs.Root).
 * Wraps both the Kumo strip (visual list) and Base UI Panels (content).
 */
export const Tabs = BaseTabs.Root;

interface TabsListProps {
  tabs: Array<{ value: string; label: string; disabled?: boolean }>;
  value: string;
  onValueChange: (value: string) => void;
  className?: string;
}

/**
 * TabsList — Kumo's data-driven tab strip. Replaces shadcn's children-based
 * composition with `tabs={[{value, label}]}`. The 2 consumer files
 * (_app.battle.tsx, _app.roadmaps.tsx) are rewritten to this shape in the
 * same plan task.
 */
export const TabsList = (props: TabsListProps) => <KumoTabsStrip {...props} />;

/**
 * TabsContent — Base UI Tabs.Panel, value-matched. Same call shape as Phase 06.
 */
export const TabsContent = BaseTabs.Panel;

/**
 * TabsTrigger — DEPRECATED post-Phase 07. Kumo's strip encodes triggers in
 * the `tabs` array. Throws if invoked to prevent silent breakage during
 * migration; the 4-name import surface is preserved so adding a TabsTrigger
 * import wouldn't crash builds, only renders.
 */
export const TabsTrigger: React.FC<{
  value?: string;
  children?: React.ReactNode;
}> = () => {
  throw new Error(
    "[Phase 07] TabsTrigger is no longer used. Pass `tabs={[{value, label}]}` to TabsList instead.",
  );
};
