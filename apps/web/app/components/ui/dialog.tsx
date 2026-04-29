"use client";
import * as React from "react";
// Use @cloudflare/kumo/primitives/dialog (Base UI Dialog re-export) so we get the
// fine-grained Backdrop/Popup/Portal namespace. The high-level
// @cloudflare/kumo/components/dialog.Dialog only exposes Root/Trigger/Title/
// Description/Close + a bundled DialogContent that auto-renders its own close
// button — too opinionated for the Phase 06 9-export contract. Same primitives
// pattern Plan 05 used for Sheet (Drawer primitives).
import { Dialog as KumoDialog } from "@cloudflare/kumo/primitives/dialog";

import { cn } from "~/lib/utils";

export const Dialog = KumoDialog.Root;

export const DialogTrigger = KumoDialog.Trigger;

export const DialogPortal = KumoDialog.Portal;

export const DialogClose = KumoDialog.Close;

export const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof KumoDialog.Backdrop>,
  React.ComponentPropsWithoutRef<typeof KumoDialog.Backdrop>
>(({ className, ...props }, ref) => (
  <KumoDialog.Backdrop
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-kumo-overlay/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className,
    )}
    {...props}
  />
));
DialogOverlay.displayName = "DialogOverlay";

/**
 * DialogContent — Phase 06's `DialogContent` auto-rendered an X close button
 * top-right. Kumo/Base UI's `Popup` does not. To preserve the consumer
 * contract this wrapper composes Portal + Backdrop + Popup + an optional
 * X close button. Consumers that don't want the X pass `closeButton={false}`.
 *
 * The X SVG matches lucide-react's X icon shape — keeps the visual identical
 * to Phase 06 without importing @phosphor-icons/react in this file.
 */
export const DialogContent = React.forwardRef<
  React.ElementRef<typeof KumoDialog.Popup>,
  React.ComponentPropsWithoutRef<typeof KumoDialog.Popup> & {
    closeButton?: boolean;
  }
>(({ className, children, closeButton = true, ...props }, ref) => (
  <KumoDialog.Portal>
    <KumoDialog.Backdrop className="fixed inset-0 z-50 bg-kumo-overlay/80 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
    <KumoDialog.Popup
      ref={ref}
      className={cn(
        "fixed left-[50%] top-[50%] z-50 grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 bg-kumo-base p-6 shadow-lg ring ring-kumo-line sm:rounded-lg",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        className,
      )}
      {...props}
    >
      {children}
      {closeButton && (
        <KumoDialog.Close
          aria-label="Close"
          className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-kumo-base transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-kumo-focus focus:ring-offset-2 disabled:pointer-events-none"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M18 6 6 18" />
            <path d="m6 6 12 12" />
          </svg>
          <span className="sr-only">Close</span>
        </KumoDialog.Close>
      )}
    </KumoDialog.Popup>
  </KumoDialog.Portal>
));
DialogContent.displayName = "DialogContent";

export const DialogTitle = React.forwardRef<
  React.ElementRef<typeof KumoDialog.Title>,
  React.ComponentPropsWithoutRef<typeof KumoDialog.Title>
>(({ className, ...props }, ref) => (
  <KumoDialog.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
      className,
    )}
    {...props}
  />
));
DialogTitle.displayName = "DialogTitle";

export const DialogDescription = React.forwardRef<
  React.ElementRef<typeof KumoDialog.Description>,
  React.ComponentPropsWithoutRef<typeof KumoDialog.Description>
>(({ className, ...props }, ref) => (
  <KumoDialog.Description
    ref={ref}
    className={cn("text-sm text-kumo-subtle", className)}
    {...props}
  />
));
DialogDescription.displayName = "DialogDescription";

// Header + Footer are styled divs (no Kumo equivalent) — token-retargeted from Phase 06.
export const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col space-y-1.5 text-center sm:text-left",
      className,
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

export const DialogFooter = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      className,
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";
